/*
 * The Ceph command bridge: a short Python program run with the Ceph
 * Python bindings (rados, rbd) inside a Rook pod that holds the admin
 * keyring (the toolbox, else the operator). It reads one request line
 * (configuration path, keyring, a batch of commands), opens one RADOS
 * connection, runs every command and prints one JSON document:
 *
 *   {"v": 1, "res": [{"r": <return code>, "out": <JSON or text>, "err": <status>, "ms": <time>}...]}
 *
 * Command types: "mon" (mon_command), "mgr" (mgr_command), "osd"
 * (osd_command, i.e. "ceph tell osd.N"), "cli" (rbd or radosgw-admin with
 * the same configuration, arguments as a list, never through a shell) and
 * "rbd_images" (image details from the rbd bindings: size, features,
 * parent, snapshots, children, watchers, trash).
 *
 * The program travels on stdin, not on the command line, so the API
 * server's audit log records a short, stable exec command (BOOTSTRAP).
 * Secrets never leave the pod: fields named key/secret/secret_key/access_key
 * are blanked in every answer (a "key" keeps its type as key_type: aes or
 * aes256k); config entries whose name looks secret (passwords, tokens, API
 * keys, the dashboard's MULTICLUSTER_CONFIG…) lose their values (marked
 * "redacted"); anything shaped like a JWT is cut out of every string; and
 * commands that print keys (auth print-key, auth export, config-key ...)
 * are refused. radosgw-admin must name a zone (--rgw-zone): without it, it
 * creates the default zone's pools. A query may carry `keys` to keep only those
 * top-level fields of a large answer.
 *
 * Keep it ASCII and Python 3.6 compatible; no backticks or template
 * placeholders (it lives in a template literal).
 */

/** The exec command: read a length line, then that many characters of program, and run it. */
export const BOOTSTRAP = ['python3', '-c', 'import sys;exec(sys.stdin.read(int(sys.stdin.readline())))'];

export const BRIDGE_PY = String.raw`import sys, json, time, subprocess, re
req = json.loads(sys.stdin.readline())
conf = req.get("conf") or "/etc/ceph/ceph.conf"
kr = req.get("keyring") or ""
base = ["--conf", conf] + (["--keyring", kr] if kr else [])
out = {"v": 1, "res": []}
def dec(b):
    s = b.decode("utf-8", "replace") if isinstance(b, bytes) else (b or "")
    if not s.strip():
        return None
    try:
        return json.loads(s)
    except ValueError:
        return s
SECRET_FIELDS = ("key", "secret", "secret_key", "access_key")
SECRET_NAME = re.compile("(?i)(secret|passw|token|jwt|multicluster_config|access_key|api_key|encryption_key|ssl_key|_key$)")
SECRET_VALUES = ("value", "new_value", "previous_value", "default", "daemon_default")
JWT = re.compile("eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]+")
DENY = ("config-key", "auth print-key", "auth print_key", "auth get-key", "auth export", "auth get-or-create", "auth rotate", "auth import", "auth add")
def keytype(v):
    if v.startswith("AQ"):
        return "aes"
    if v.startswith("Ag"):
        return "aes256k"
    return "unknown"
def redact(o):
    if isinstance(o, dict):
        n = {}
        secret_name = isinstance(o.get("name"), str) and SECRET_NAME.search(o["name"])
        for k, v in o.items():
            if k in SECRET_FIELDS and isinstance(v, str):
                n[k] = ""
                if k == "key":
                    n["key_type"] = keytype(v)
            elif secret_name and k in SECRET_VALUES and isinstance(v, str) and v:
                n[k] = ""
                n["redacted"] = True
            else:
                n[k] = redact(v)
        return n
    if isinstance(o, list):
        return [redact(x) for x in o]
    if isinstance(o, str):
        return JWT.sub("<redacted>", o)
    return o
def ts(v):
    try:
        return v.isoformat()
    except Exception:
        return None
def tryget(f, d=None):
    try:
        return f()
    except Exception:
        return d
def rbd_images(c, q):
    import rbd
    io = c.open_ioctx(q["pool"])
    if q.get("ns"):
        io.set_namespace(q["ns"])
    names = q.get("images") or rbd.RBD().list(io)
    imgs = []
    for n in names:
        try:
            im = rbd.Image(io, n, read_only=True)
        except Exception as ex:
            imgs.append({"name": n, "error": str(ex)})
            continue
        try:
            st = im.stat()
            d = {"name": n, "id": tryget(im.id), "size": st.get("size"), "obj_size": st.get("obj_size"),
                 "num_objs": st.get("num_objs"), "order": st.get("order"), "prefix": st.get("block_name_prefix"),
                 "features": tryget(im.features), "flags": tryget(im.flags), "op_features": tryget(im.op_features),
                 "created": ts(tryget(im.create_timestamp)), "modified": ts(tryget(im.modify_timestamp)),
                 "data_pool_id": tryget(im.data_pool_id)}
            p = tryget(im.get_parent_image_spec)
            if p:
                d["parent"] = {"pool": p.get("pool_name"), "ns": p.get("pool_namespace"), "image": p.get("image_name"), "snap": p.get("snap_name")}
            snaps = []
            for s in tryget(im.list_snaps, []) or []:
                snaps.append({"id": s.get("id"), "name": s.get("name"), "size": s.get("size"),
                              "ns_type": s.get("namespace"),
                              "protected": tryget(lambda: im.is_protected_snap(s["name"])),
                              "time": ts(tryget(lambda: im.get_snap_timestamp(s["id"])))})
            d["snaps"] = snaps
            d["children"] = [{"pool": x.get("pool"), "ns": x.get("pool_namespace"), "image": x.get("image"), "trash": x.get("trash")} for x in (tryget(im.list_children2, []) or [])]
            if q.get("watchers"):
                d["watchers"] = [{"addr": w.get("addr"), "id": w.get("id")} for w in (tryget(im.watchers_list, []) or [])]
            imgs.append(d)
        finally:
            im.close()
    trash = []
    if q.get("trash"):
        for t in tryget(lambda: list(rbd.RBD().trash_list(io)), []) or []:
            trash.append({"id": t.get("id"), "name": t.get("name"), "source": t.get("source"),
                          "deleted": ts(t.get("deletion_time")), "deferred_until": ts(t.get("deferment_end_time"))})
    nss = tryget(lambda: list(rbd.RBD().namespace_list(io)), []) if q.get("namespaces") else None
    io.close()
    return {"images": imgs, "trash": trash, "namespaces": nss}
try:
    import rados
    c = rados.Rados(conffile=conf, conf=({"keyring": kr} if kr else {}))
    c.connect(timeout=req.get("timeout", 15))
except Exception as ex:
    out["fatal"] = "%s: %s" % (type(ex).__name__, ex)
    sys.stdout.write(json.dumps(out))
    sys.exit(0)
for q in req.get("cmds", []):
    t0 = time.time()
    r = {"r": 0, "out": None, "err": ""}
    try:
        t = q["t"]
        if t in ("mon", "mgr", "osd"):
            cmd = dict(q["cmd"])
            pre = str(cmd.get("prefix", ""))
            if any(pre == d or pre.startswith(d + " ") or pre.startswith(d) for d in DENY):
                raise ValueError("Cairn does not run commands that print secrets: " + pre)
            cmd.setdefault("format", "json")
            inb = (q.get("in") or "").encode()
            tmo = q.get("timeout", 30)
            if t == "mon":
                rc, o, e = c.mon_command(json.dumps(cmd), inb, timeout=tmo)
            elif t == "mgr":
                rc, o, e = c.mgr_command(json.dumps(cmd), inb, timeout=tmo)
            else:
                rc, o, e = c.osd_command(int(q["id"]), json.dumps(cmd), inb, timeout=tmo)
            r = {"r": rc, "out": redact(dec(o)), "err": e}
        elif t == "cli":
            if q["bin"] not in ("rbd", "radosgw-admin"):
                raise ValueError("unsupported program " + str(q["bin"]))
            if q["bin"] == "radosgw-admin" and "--rgw-zone" not in [str(a) for a in q["args"]]:
                raise ValueError("radosgw-admin needs --rgw-zone: without it, it creates the pools of a default zone")
            p = subprocess.run([q["bin"]] + base + [str(a) for a in q["args"]], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=q.get("timeout", 60))
            r = {"r": -p.returncode, "out": redact(dec(p.stdout)), "err": p.stderr.decode("utf-8", "replace")[-4000:]}
        elif t == "rbd_images":
            r["out"] = rbd_images(c, q)
        else:
            raise ValueError("unknown command type " + str(t))
    except Exception as ex:
        r = {"r": -1, "out": None, "err": "%s: %s" % (type(ex).__name__, ex)}
    if q.get("keys") and isinstance(r.get("out"), dict):
        r["out"] = dict((k, r["out"].get(k)) for k in q["keys"])
    r["ms"] = int((time.time() - t0) * 1000)
    out["res"].append(r)
c.shutdown()
sys.stdout.write(json.dumps(out))
`;
