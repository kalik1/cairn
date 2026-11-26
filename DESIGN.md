# Cairn: design

Cairn is a Headlamp plugin that gives a Rook-managed Ceph cluster a complete
storage console: health with every check explained, capacity, performance,
placement groups, hosts and OSDs with their operations, daemons, pools, RBD
images and snapshots, CephFS, object storage, the Kubernetes side
(StorageClasses, CSI, volumes), cephx security and Ceph configuration. It is a
separate addon from the k4all plugin and from Hangar: it works on any cluster
with Rook, and k4all installs it like any other Headlamp plugin (README.md).

## 1. The idea

Ceph is run through two control planes that do not overlap: **Rook** owns the
desired state (CephCluster, CephBlockPool, CephFilesystem, CephObjectStore…
custom resources) and reconciles Ceph to it; **Ceph** owns the runtime (health,
OSD state, PGs, recovery, RBD images, config, crash reports, cephx). A console
that only lists CRs (what the community plugin did) cannot say whether data is
safe; one that only talks to Ceph fights the operator when it creates pools
that Rook does not know.

Cairn splits writes accordingly:

| Change | How Cairn makes it |
|---|---|
| Pools, file systems, subvolume groups, object stores, users, buckets (OBC), CephClients, storage spec (disks, nodes), manager and monitor counts, mgr module entries, cephx key rotation, persistent health mutes, Rook-managed config | Edit the Rook custom resource (YAML diff preview, server-side dry run, Apply). Rook applies it to Ceph. |
| StorageClasses, VolumeSnapshotClasses, VolumeSnapshots | Kubernetes objects, same preview |
| OSD out/in, reweight, flags, scrub, maintenance, health mute with a TTL, crash archive, runtime config (`config set/rm`), RBD snapshots/rollback/trash, image create/resize | Ceph commands (the bridge, below): runtime operations Rook does not model |

## 2. Data access: evaluation and choice

Three ways to reach Ceph's runtime from a browser page served by Headlamp were
evaluated on a test cluster (Rook 1.21.2, Ceph 20.2.4, Headlamp 0.46 in token
mode and in kubeconfig mode).

### Ceph Dashboard REST API through the API server's service proxy (rejected)

`/api/v1/namespaces/rook-ceph/services/http:rook-ceph-mgr-dashboard:http-dashboard/proxy/api/...`
answers, and logging in with the `admin` password works. But the token cannot
be kept in memory and sent per request:

- The dashboard takes its JWT from the `Authorization: Bearer` header or from a
  cookie named `token`. The API server consumes `Authorization` (it
  authenticates the Kubernetes user and removes the header), so the JWT only
  reaches the dashboard as a cookie. Browsers do not let a page set `Cookie`.
- The login answer carries `Set-Cookie: token=<JWT>; HttpOnly; Path=/`
  (hard-coded in the dashboard, `controllers/_auth.py`). Headlamp's backend
  passes it through, so the browser stores the Ceph admin JWT for the
  Headlamp host and path `/`, and from then on sends it with every request to
  that host, on every port: to every service and pod proxied through Headlamp
  and to aggregated API servers. Headlamp authenticates its own requests with
  an HttpOnly cookie too (`credentials: 'include'`), so the login cannot be
  made without cookies. A page-set path-scoped cookie loses against it (Ceph's
  cookie parser keeps the last `token`, the `Path=/` one).
- Every operation would run as the dashboard `admin` user: Kubernetes RBAC and
  audit would not tell who did what. Reading the password needs `get secrets`
  in the Rook namespace anyway, which is Ceph-admin-equivalent.
- The API lacks health mute/unmute and crash reports.

Verified with curl through the API server and through both Headlamp backends
(the cookie is forwarded; `Set-Cookie: token=...; Path=/` comes back).

### mgr prometheus module through the service proxy (kept for later)

`http:rook-ceph-mgr:http-metrics/proxy/metrics` (Rook enables the module) is
read-only and needs only `get services/proxy`: a good source for a viewer role.
It has health check codes but not their messages, no RBD, no config, no
operations. Not used in 0.1 (section 8).

### Ceph commands through `pods/exec` (chosen): the bridge

Cairn runs a short Python program (`src/api/bridgeScript.ts`) with the Ceph
Python bindings (`rados`, `rbd`) in a Rook pod that holds the admin keyring:
the Rook toolbox (`app=rook-ceph-tools`) when it runs, else the operator pod
(the same choice the official `kubectl rook-ceph` plugin makes). One exec runs
one batch: it opens one RADOS connection, runs every command (`mon_command`,
`mgr_command`, `osd_command`, the rbd bindings, or `rbd`/`radosgw-admin` with
arguments as a list, never a shell) and prints one JSON answer. A batch of ten
commands takes about 0.4 s on a three-OSD test cluster.

- **Auth**: the exec WebSocket is opened with Headlamp's own `stream()`, so it
  authenticates like everything else in Headlamp (kubeconfig, or the HttpOnly
  cookie of a token login; verified in-cluster). No Ceph secret ever reaches
  the browser.
- **RBAC and audit**: `create pods/exec` in the Rook namespace decides who may
  use Ceph through Cairn, and every batch is an exec request in the API
  server's audit log under the user's name. The program travels on stdin
  (`python3 -c "import sys;exec(sys.stdin.read(int(sys.stdin.readline())))"`),
  so the audit log gets a short stable command line.
- **Secrets stay in the pod**: the program blanks every field named `key`,
  `secret`, `secret_key` or `access_key` in every answer (a `key` keeps its
  type as `key_type`: `aes` or `aes256k`), blanks the values of config
  entries whose name looks secret (passwords, tokens, API keys, the
  dashboard's `MULTICLUSTER_CONFIG`, which holds session tokens), cuts
  anything shaped like a JWT out of every string, and refuses the commands
  that print keys (`auth print-key`, `auth get-key`, `auth export`,
  `auth get-or-create`, `auth rotate`, `config-key …`). Object store user
  keys are shown only on request, from the Kubernetes Secret Rook writes,
  after an RBAC check, and hidden again after two minutes.
- **Safety**: a batch that started is never retried (commands may not be
  idempotent); only an exec that could not start (pod gone) is retried once in
  a freshly found pod. At most three execs run at once.
- **Trade-off**: exec in the Rook namespace is a powerful permission (the admin
  keyring; in the operator pod also the operator's service account). That is
  the honest size of "Ceph administrator"; `distribution/rbac.yaml` gives it as
  a separate role. Users without it still see everything Kubernetes knows
  (Rook resources with their status, including Rook's copy of Ceph health and
  capacity, StorageClasses, volumes, CSI), and every place that needs live Ceph
  data says why it is missing.

### Live state and history

`src/api/ceph.tsx` polls one batch every 10 s while the tab is visible
(`status`, `health detail`, `osd df tree`, `osd dump`, `df detail`, `osd perf`,
`osd pool stats`, `crash ls`, `healthcheck history ls`, `progress json`, and the
PG list when the cluster has up to 4096 PGs) and slower facts once a minute
(`osd metadata`, `quorum_status`, `versions`, `mgr dump` projected to a few
fields, `osd crush rule dump`, `osd pool autoscale-status`, `balancer status`).
Each poll feeds in-memory time series (client throughput and IOPS, recovery,
OSD latency, per-pool rates): charts start when Cairn opens and keep an hour.
Views run their own batches with `useCephQuery()` (cached per key, shared,
refetched on an interval while mounted).

The app-bar badge reads only the CephCluster status (Rook refreshes Ceph's
health there every minute): it costs one list request every 30 s and no exec.

## 3. Screens

One Headlamp route, `/ceph/:view?/:a?/:b?/:c?`; the top bar shows the
CephCluster (a picker when there are several), Ceph's version, its health in
one word, the live stamp and refresh; below it the views.

- **Overview** (`/ceph`): the verdict band (data safety in one sentence, key
  figures, the PG field: every placement group as a cell by pool and state
  category, with a keyboard/pointer readout), recovery and progress, a daemon
  summary, the health checks (all expanded, explained by `model/health.ts`,
  with since-when, mute in Ceph or through Rook, past checks), Cairn's alerts
  (`model/alerts.ts`), capacity, performance charts, crash reports.
- **Hosts & OSDs** (`/ceph/osds`, `/ceph/osds/<id>`): host shelves with a drive
  bay per OSD, the cluster flags, the OSD table with bulk actions, the OSD page
  (fill, latency, backing device and pod, its PGs, operations), maintenance
  (host or OSDs) and adding disks or nodes to the storage spec
  (`model/clusterSpec.ts`).
- **Daemons** (`/ceph/daemons/<tab>`): monitors, managers and modules, daemon
  pods and versions, the Rook operator and events. The Monitors and Managers
  tabs say how many daemons the CephCluster asks for and change it
  (`model/daemonCounts.ts`, section 6).
- **Pools** (`/ceph/pools`, `/ceph/pools/<pool>`): the cluster's raw capacity by
  pool, the pool table, the pool page with its capacity strata; create, edit and
  delete through CephBlockPool (`model/pools.ts`: spec builder, impact, delete
  guards, ownership).
- **Block** (`/ceph/rbd/<pool>/<image>/<namespace>`): images with their
  Kubernetes binding (`model/rbd.ts`: features, PV → PVC → pod/VM), trash, the
  image page with snapshots, clones and resize.
- **File** (`/ceph/cephfs/<fs>`), **Object** (`/ceph/object/<store>/<tab>`): file
  systems with MDS ranks, subvolume groups and subvolumes; object stores with
  users, buckets and claims.
- **Kubernetes** (`/ceph/kubernetes/<tab>`): storage classes (and the wizard),
  volumes, CSI drivers node by node.
- **Security** (`/ceph/security`): the cephx migration ladder, the CVE in plain
  words, entities, CephClients (`model/cephx.ts`).
- **Configuration** (`/ceph/config/<tab>`): Ceph settings, cluster and audit
  logs, Kubernetes events, Cairn's own settings and access summary.
- **Activity** (`/ceph/activity`): every operation started from Cairn in this
  browser with Ceph's or the API server's answer.

## 4. Look and feel

A geologist's section of the cluster. Pages are quiet and dense: Headlamp's
theme and font (no web font, air-gap friendly), light and dark, tabular
numbers, hairline panels, one icon set (mdi, bundled offline by
`scripts/gen-icons.mjs`). Data is drawn as strata and fields. Each screen has
**one loud element** on a dark basalt band (`Band`): the health verdict with
the placement-group field on the overview, the host shelves with a drive bay
per OSD on Hosts & OSDs, the capacity strata of a pool, the core sample of an
RBD image, the cephx migration ladder on Security. Everything around it stays
calm.

State colours carry data safety everywhere and always come with a word:
lichen (clean, up, in), ochre (needs attention), garnet (failing, data at
risk), cobalt (moving: recovery, backfill, scrub; pulses unless reduced
motion is on), slate (off, unknown). Chart series: cobalt reads, violet
writes, ochre recovery, teal latency. Identifiers (osd.3, image names, config
keys, cephx entities) are monospace. The mark is three stacked stones, the
top one in the cluster's health colour (sidebar, top bar, app-bar badge).

Copy is sentence case with verbs on buttons ("Mark out", "Create pool",
"Validate"); errors say what happened and what to do; every destructive
action lists its consequences, and deletes ask for the name.

## 5. Code layout

```
plugin/
  scripts/gen-icons.mjs   bundles the mdi icons the sources use (prebuild)
  src/index.tsx           sidebar entry, the route, the app-bar health badge
  src/shell/              CairnApp (providers, layout), TopBar, nav (routes), Gate (live-data
                          gate and messages), ActivityStrip, HealthBadge, settings
  src/api/                bridge + bridgeScript (Ceph commands via exec), ceph (live state,
                          queries), kube (Kubernetes lists), apply (writes with dry run),
                          activity (operation log), permissions (SSAR), client, resources,
                          per-area operations (osdOps, healthOps, poolOps, rbdOps, fsOps,
                          objectOps, securityOps, k8sOps, configOps)
  src/model/              pure logic with unit tests: parse (Ceph JSON), format, history,
                          exec (channel framing), diff, health (check catalog), alerts, pg,
                          osd, clusterSpec, daemonCounts, ownership (managedFields), pools,
                          rbd, cephfs, object, cephx, storageclass, csi, config, events,
                          badge; fixtures.sample.ts = real answers, anonymized
  src/ui/                 tokens, kit, Mark, DataTable, dialogs, ChangeDialog, charts, CairnMark
  src/views/              overview, osds, daemons, pools, rbd, cephfs, object, kubernetes,
                          security, config, activity
```

## 6. Decisions

- One Headlamp route, `/ceph/:view?/:a?/:b?/:c?`, so the live state and chart
  history survive moving between views. The overview, OSD, pool and RBD
  image URLs are stable (other plugins link to them).
- Writes to what Rook owns go through Rook's custom resources, never through
  Ceph commands, so the operator does not undo them and the cluster's
  desired state stays in Git-friendly YAML. Runtime operations Rook does not
  model are Ceph commands.
- Every Kubernetes write shows the YAML diff and can be validated with a
  server-side dry run before it is applied. Updates are JSON Patches with a
  `test` for every edited field: a concurrent change to those fields is
  refused, not overwritten, while Rook's own status writes (every minute on a
  CephCluster) do not make them fail as a PUT with the resourceVersion would.
- The app-bar badge reads only the CephCluster status: it must be cheap on
  every Headlamp page and must work for users without exec rights.
- Two mutes: Ceph's own (`health mute`, with a TTL, for "I know, stop telling
  me today") and Rook's persistent one (`spec.healthCheck.muteHealthWarning`,
  for a decision that must survive restarts and be visible in the CR).
- Manager and monitor counts are `spec.mgr.count` and `spec.mon.count`, never
  Ceph commands. Managers: 1 or 2 (Rook's limit); 2 needs two nodes that can
  run one unless `mgr.allowMultiplePerNode`. Monitors: 1, 3 or 5, and the
  current count if it is another; without `mon.allowMultiplePerNode` no more
  than the nodes Rook can place one on (not cordoned, taints tolerated by
  `placement.all`/`placement.mon`, required node affinity met). A monitor
  change is offered only while every monitor in the monmap is in quorum and
  the monmap already has the count the spec asks for: adding or removing a
  monitor while one is out, or while Rook is still moving, can lose the
  quorum. Fewer than three monitors on a cluster with three or more nodes
  needs the cluster name typed. Each choice is listed with what it means;
  the ones the cluster cannot take are disabled with the reason, not hidden.
- A mgr module entry Rook ignores is offered for removal from the
  CephCluster: Rook 1.21 disables the `rook` module on Ceph 20 (Tentacle) and
  later whatever `spec.mgr.modules` says. The Ceph version is the one Rook
  detected (`status.version`), else the oldest manager version.
- One owner per field (k4all spec §4 R9; `model/ownership.ts`, the same
  file as Hangar's). Platforms that apply the CephCluster with server-side
  apply (k4all) put their value back at their next apply, so a field whose
  `metadata.managedFields` entry belongs to field manager `k4all-operator`
  (exactly: `k4all-operator-seed`, the create-only seed, does not count)
  is shown read-only, with "Managed by k4all — change it in the k4all addon"
  and a link to the k4all plugin's storage settings
  (`k4all-settings` route + `/storage`) when it is registered. The FieldsV1
  walk: reaching the field covers it; an empty set above the field covers it
  only when the live value there is a list or a scalar (owned whole), so an
  applied empty struct owns none of its children; `.` alone owns only the
  parent's existence. On k4all v2.7.0 the operator owns only
  `spec.cephVersion.image` (D18), shown read-only on Daemons → Rook
  operator. Headlamp's list hooks delete `metadata.managedFields` from
  every listed object, so the check never runs on the list copy: the
  control reads a GET of the CephCluster (`api/managedFields.ts`, again
  when the listed copy's resourceVersion changes), and the preview a fresh
  read; when that read fails on k4all, no change is prepared (the list copy
  cannot tell). Other managers leave the field editable;
  without k4all (discovery does not serve `k4all.magesgate.com`) everything
  is.
- cephx: the CVE-2025-30156 migration is offered as Rook spec changes
  (key generation bumps, then `allowedCiphers: [aes256k]`) behind a typed
  confirmation, with live status for every step. Cairn never rotates keys
  with `ceph auth rotate` (it would bypass the Secrets Rook keeps).

## 7. Known limits

- Live data and operations need `create pods/exec` in the Rook namespace;
  without it Cairn shows the Kubernetes side only (section 2).
- Without a Rook toolbox the bridge runs in the operator pod, inside its
  memory limit (each batch is a short Python process of a few tens of MB);
  production clusters should run the toolbox.
- Charts start when Cairn opens and keep an hour, in the browser.
- The PG field is refreshed every poll up to 4096 PGs, once a minute above.
- Tables render 300 rows, then "Show all".
- `radosgw-admin` always runs with the store's realm/zone group/zone (the
  bridge refuses it without `--rgw-zone`: without a zone it creates the default
  zone's pools).
- Ceph's `log last` at level info is often empty on a quiet cluster; the logs
  view offers debug entries.
- Rook 1.21's ceph-csi Driver CRs have no status: the CSI view reads the
  controller and node plugin workloads instead.
- An object store user's keys are read from the Secret Rook writes, so showing
  them needs `get secrets` in that namespace.

## 8. Later

- A read-only viewer mode fed by the mgr prometheus module through the service
  proxy (`get services/proxy` only), for users without exec rights.
- Longer history from a Prometheus server when one scrapes Ceph.
- RBD mirroring, NFS exports, NVMe-oF gateways and multisite object storage
  views (Cairn lists their CRs but has no dedicated screens).
- Translations (Italian first) through Headlamp's i18n.
