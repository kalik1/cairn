/*
 * Cephx keys and ciphers: the entities Ceph knows (auth ls, auth
 * dump-keys; the bridge blanks every secret), what kind of key each one
 * holds, and where the cluster stands on the CVE-2025-30156 migration
 * ladder (daemon keys, CSI keys, CephClients, RBD mirror peers, then no
 * more aes). The changes are CephCluster / CephClient spec edits that Rook
 * carries out; the builders here return the edited objects for the change
 * preview.
 */

import { Obj, Quorum } from './types';

export type KeyType = 'aes' | 'aes256k' | 'none' | 'unknown';

/** Who owns a key, for the ladder: Rook daemons, Ceph-CSI, CephClient CRs, the RBD mirror peer, or anything else. */
export type EntityKind = 'daemon' | 'csi' | 'cephclient' | 'mirror' | 'other';

export interface CephxEntity {
  /** "osd.0", "client.admin", "mgr.a". */
  entity: string;
  /** "osd", "client", "mgr", "mds", "mon"… */
  type: string;
  id: string;
  keyType: KeyType;
  /** A key being rotated in (dump-keys pending_key), when there is one. */
  pendingKeyType?: KeyType;
  /** When the current key was created (ms). */
  created?: number | null;
  caps: Record<string, string>;
  kind: EntityKind;
}

export const KIND_WORD: Record<EntityKind, string> = {
  daemon: 'Ceph daemon',
  csi: 'Ceph-CSI',
  cephclient: 'CephClient',
  mirror: 'RBD mirror peer',
  other: 'Other client',
};

const obj = (v: unknown): any => (v && typeof v === 'object' ? v : {});
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function keyTypeOf(v: unknown): KeyType {
  const s = str(v).toLowerCase();
  if (s === 'aes' || s === 'aes256k' || s === 'none') return s;
  return 'unknown';
}

/** Ceph's binary-encoded caps in dump-keys carry a 4-byte length prefix: drop it. */
export function decodeCap(s: string): string {
  if (s.length >= 4) {
    const n = s.charCodeAt(0) + (s.charCodeAt(1) << 8) + (s.charCodeAt(2) << 16) + (s.charCodeAt(3) << 24);
    if (n === s.length - 4) return s.slice(4);
  }
  return s;
}

function cephTimeMs(v: unknown): number | null {
  const s = str(v).trim();
  if (!s || s.startsWith('0.0')) return null;
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2').replace(/\.(\d{3})\d+/, '.$1'));
  return isNaN(t) ? null : t;
}

function splitEntity(entity: string): { type: string; id: string } {
  const i = entity.indexOf('.');
  return i < 0 ? { type: entity, id: '' } : { type: entity.slice(0, i), id: entity.slice(i + 1) };
}

const DAEMON_CLIENTS = new Set(['admin', 'admin-rotator', 'crash', 'ceph-exporter', 'fs-mirror', 'cephfs-mirror']);
const DAEMON_CLIENT_PREFIX = /^(rgw\.|nfs-ganesha\.|rbd-mirror\.|nvmeof\.|bootstrap-|mds\.)/;

/** The ladder category of an entity; `cephClients` are the Ceph user names of CephClient CRs. */
export function entityKind(entity: string, cephClients: Set<string> = new Set()): EntityKind {
  const { type, id } = splitEntity(entity);
  if (['mon', 'mgr', 'osd', 'mds'].includes(type)) return 'daemon';
  if (type !== 'client') return 'other';
  if (id.startsWith('csi-')) return 'csi';
  if (id === 'rbd-mirror-peer') return 'mirror';
  if (cephClients.has(id)) return 'cephclient';
  if (DAEMON_CLIENTS.has(id) || DAEMON_CLIENT_PREFIX.test(id)) return 'daemon';
  return 'other';
}

/** The Ceph user a CephClient CR makes: spec.name, else the CR name. */
export function cephClientUser(cr: Obj): string {
  return str(cr.spec?.name) || cr.metadata.name;
}

/** "auth ls": entities with caps; key types as the bridge guessed them from the key prefix. */
export function parseAuthList(raw: any, cephClients: Set<string> = new Set()): CephxEntity[] {
  return arr(obj(raw).auth_dump).map((e: any) => {
    const entity = str(e.entity);
    const { type, id } = splitEntity(entity);
    const caps: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(e.caps))) caps[k] = str(v);
    return { entity, type, id, keyType: keyTypeOf(e.key_type), caps, kind: entityKind(entity, cephClients) };
  });
}

export interface DumpKeys {
  /** entity → key type, pending key type, creation time. */
  keys: Map<string, { keyType: KeyType; pending: KeyType; created: number | null; caps: Record<string, string> }>;
  /** Rotating service keys (mon, osd, mds, mgr, auth): their key types. */
  rotating: { service: string; keyTypes: KeyType[] }[];
}

/** "auth dump-keys": the authoritative key type of every entity (type_str). */
export function parseDumpKeys(raw: any): DumpKeys {
  const d = obj(obj(raw).data);
  const keys: DumpKeys['keys'] = new Map();
  for (const s of arr(d.secrets)) {
    const ent = obj(s.entity);
    const name = ent.id !== undefined && ent.id !== '' ? `${str(ent.type_str)}.${str(ent.id)}` : str(ent.type_str);
    const auth = obj(s.auth);
    const caps: Record<string, string> = {};
    for (const c of arr(auth.caps)) caps[str(c.service_name)] = decodeCap(str(c.access_spec));
    keys.set(name, {
      keyType: keyTypeOf(obj(auth.key).type_str),
      pending: keyTypeOf(obj(auth.pending_key).type_str),
      created: cephTimeMs(obj(auth.key).created),
      caps,
    });
  }
  const rotating = arr(d.rotating_secrets).map((r: any) => ({
    service: str(obj(r.entity).type_str),
    keyTypes: arr(obj(r.secrets).keys).map((k: any) => keyTypeOf(obj(obj(k.expiring_key).key).type_str)),
  }));
  return { keys, rotating };
}

/**
 * The entities with their real key types: auth ls (caps) corrected by
 * dump-keys (type_str), plus entities only dump-keys lists.
 */
export function mergeEntities(list: CephxEntity[], dump: DumpKeys | null, cephClients: Set<string> = new Set()): CephxEntity[] {
  const out = list.map(e => {
    const k = dump?.keys.get(e.entity);
    if (!k) return e;
    return {
      ...e,
      keyType: k.keyType !== 'unknown' ? k.keyType : e.keyType,
      pendingKeyType: k.pending !== 'none' && k.pending !== 'unknown' ? k.pending : undefined,
      created: k.created,
    };
  });
  if (dump) {
    const seen = new Set(out.map(e => e.entity));
    for (const [entity, k] of dump.keys) {
      if (seen.has(entity)) continue;
      const { type, id } = splitEntity(entity);
      out.push({
        entity,
        type,
        id,
        keyType: k.keyType,
        pendingKeyType: k.pending !== 'none' && k.pending !== 'unknown' ? k.pending : undefined,
        created: k.created,
        caps: k.caps,
        kind: entityKind(entity, cephClients),
      });
    }
  }
  return out;
}

export interface KeySummary {
  total: number;
  aes256k: number;
  aes: number;
  other: number;
  byKind: Record<EntityKind, { total: number; aes256k: number; aes: number }>;
}

export function keySummary(es: CephxEntity[]): KeySummary {
  const blank = () => ({ total: 0, aes256k: 0, aes: 0 });
  const s: KeySummary = {
    total: 0,
    aes256k: 0,
    aes: 0,
    other: 0,
    byKind: { daemon: blank(), csi: blank(), cephclient: blank(), mirror: blank(), other: blank() },
  };
  for (const e of es) {
    s.total++;
    const k = s.byKind[e.kind];
    k.total++;
    if (e.keyType === 'aes256k') {
      s.aes256k++;
      k.aes256k++;
    } else if (e.keyType === 'aes') {
      s.aes++;
      k.aes++;
    } else s.other++;
  }
  return s;
}

/* -------------------------------------------------------------- ladder */

export type StepId = 'daemon' | 'csi' | 'clients' | 'mirror' | 'ciphers';
/** done, to do, partly done, nothing to do here, not known (no live data). */
export type StepState = 'done' | 'todo' | 'partial' | 'none' | 'unknown';

export interface LadderStep {
  id: StepId;
  title: string;
  state: StepState;
  /** What the live state says, one line each. */
  evidence: string[];
  /** Entities of this step still on aes. */
  insecure: string[];
  /** Keys counted for this step, and how many are on aes256k. */
  total: number;
  secure: number;
  /** Rook is carrying out a change: spec generation above the status one. */
  pending?: string;
  /** Why the action is not offered (step 5 before every key is aes256k). */
  blockedBy?: string;
}

export interface LadderInput {
  /** null when Ceph's live state is not available. */
  entities: CephxEntity[] | null;
  rotating?: DumpKeys['rotating'];
  quorum: Quorum | null;
  cluster: Obj | null;
  clients: Obj[];
  /** Active health check codes. */
  checks: string[];
  /** CephNFS resources (their per-export keys cannot be rotated yet). */
  nfsCount?: number;
}

const DAEMON_STATUS = ['admin', 'mon', 'mgr', 'osd', 'crashCollector', 'cephExporter'] as const;

const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);

/** spec.security.cephx of a CephCluster. */
export function cephxSpec(cluster: Obj | null): any {
  return obj(obj(obj(cluster?.spec).security).cephx);
}

/** The lowest key generation Rook reports for the daemon keys (status.cephx), when known. */
export function daemonGeneration(cluster: Obj | null): { min?: number; max?: number; byDaemon: Record<string, number | undefined> } {
  const st = obj(obj(cluster?.status).cephx);
  const byDaemon: Record<string, number | undefined> = {};
  for (const d of DAEMON_STATUS) byDaemon[d] = num(obj(st[d]).keyGeneration);
  const gens = Object.values(byDaemon).filter((g): g is number => g !== undefined);
  return { min: gens.length ? Math.min(...gens) : undefined, max: gens.length ? Math.max(...gens) : undefined, byDaemon };
}

/** A CSI key name "csi-rbd-node.2" → base "csi-rbd-node", generation 2. */
export function csiKeyParts(id: string): { base: string; gen: number } {
  const m = id.match(/^(.*)\.(\d+)$/);
  return m ? { base: m[1], gen: Number(m[2]) } : { base: id, gen: 0 };
}

function stepFor(id: StepId, title: string, es: CephxEntity[]): LadderStep {
  const secure = es.filter(e => e.keyType === 'aes256k').length;
  return {
    id,
    title,
    state: es.length === 0 ? 'none' : secure === es.length ? 'done' : secure === 0 ? 'todo' : 'partial',
    evidence: [],
    insecure: es.filter(e => e.keyType !== 'aes256k').map(e => e.entity),
    total: es.length,
    secure,
  };
}

const unknownStep = (id: StepId, title: string): LadderStep => ({
  id,
  title,
  state: 'unknown',
  evidence: ["Needs Ceph's live state (auth dump-keys)."],
  insecure: [],
  total: 0,
  secure: 0,
});

export const STEP_TITLES: Record<StepId, string> = {
  daemon: 'Daemon keys on aes256k',
  csi: 'Ceph-CSI keys on aes256k',
  clients: 'CephClient keys on aes256k',
  mirror: 'RBD mirror peer key on aes256k',
  ciphers: 'Stop allowing aes',
};

/** Where the cluster stands on each step of the migration, from the live state. */
export function cephxLadder(inp: LadderInput): LadderStep[] {
  const spec = cephxSpec(inp.cluster);
  const st = obj(obj(inp.cluster?.status).cephx);
  const checks = new Set(inp.checks);
  const clientUsers = new Set(inp.clients.map(cephClientUser));
  const es = inp.entities;

  // 1. Daemons
  let daemon: LadderStep;
  if (!es) daemon = unknownStep('daemon', STEP_TITLES.daemon);
  else {
    daemon = stepFor('daemon', STEP_TITLES.daemon, es.filter(e => e.kind === 'daemon'));
    daemon.evidence.push(`${daemon.secure} of ${daemon.total} daemon keys are aes256k.`);
    const rot = (inp.rotating ?? []).filter(r => r.keyTypes.length);
    const rotAes = rot.filter(r => r.keyTypes.some(k => k !== 'aes256k')).map(r => r.service);
    if (rot.length) daemon.evidence.push(rotAes.length ? `Rotating service keys still on aes: ${rotAes.join(', ')}.` : 'Rotating service keys are aes256k.');
    if (inp.quorum?.serviceCipher) daemon.evidence.push(`Service tickets use ${inp.quorum.serviceCipher}.`);
    const serviceInsecure =
      (inp.quorum?.serviceCipher && inp.quorum.serviceCipher !== 'aes256k') ||
      rotAes.length > 0 ||
      checks.has('AUTH_INSECURE_SERVICE_KEY_TYPE') ||
      checks.has('AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE');
    if (daemon.state === 'done' && serviceInsecure) daemon.state = 'partial';
    if (checks.has('AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE'))
      daemon.evidence.push('AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE is active: it clears 2 to 3 hours after the daemon keys rotate.');
  }
  const gen = daemonGeneration(inp.cluster);
  const wanted = num(obj(spec.daemon).keyGeneration);
  if (wanted !== undefined && gen.min !== undefined && wanted > gen.min) daemon.pending = `Rook is rotating the daemon keys to generation ${wanted} (status: ${gen.min}).`;
  if (gen.max !== undefined) daemon.evidence.push(`Rook reports daemon key generation ${gen.min === gen.max ? gen.max : `${gen.min} to ${gen.max}`}.`);

  // 2. CSI
  let csi: LadderStep;
  if (!es) csi = unknownStep('csi', STEP_TITLES.csi);
  else {
    const all = es.filter(e => e.kind === 'csi');
    const latest = new Map<string, number>();
    for (const e of all) {
      const p = csiKeyParts(e.id);
      latest.set(p.base, Math.max(latest.get(p.base) ?? 0, p.gen));
    }
    const current = all.filter(e => csiKeyParts(e.id).gen === latest.get(csiKeyParts(e.id).base));
    const prior = all.filter(e => !current.includes(e));
    csi = stepFor('csi', STEP_TITLES.csi, all);
    const curSecure = current.filter(e => e.keyType === 'aes256k').length;
    csi.evidence.push(`${curSecure} of ${current.length} current Ceph-CSI keys are aes256k.`);
    const priorAes = prior.filter(e => e.keyType !== 'aes256k');
    if (prior.length)
      csi.evidence.push(
        `${prior.length} prior key${prior.length === 1 ? '' : 's'} kept for volumes mounted before the rotation${priorAes.length ? ` (${priorAes.length} on aes)` : ''}.`
      );
    if (current.length && curSecure === current.length && priorAes.length) csi.state = 'partial';
  }
  const csiSpec = obj(spec.csi);
  const csiGen = num(obj(st.csi).keyGeneration);
  if (num(csiSpec.keyGeneration) !== undefined && csiGen !== undefined && csiSpec.keyGeneration > csiGen)
    csi.pending = `Rook is rotating the Ceph-CSI keys to generation ${csiSpec.keyGeneration} (status: ${csiGen}).`;
  if (num(csiSpec.keepPriorKeyCountMax)) csi.evidence.push(`Rook keeps ${csiSpec.keepPriorKeyCountMax} prior key generation (keepPriorKeyCountMax).`);

  // 3. CephClients
  let clients: LadderStep;
  if (!es) clients = unknownStep('clients', STEP_TITLES.clients);
  else {
    const mine = es.filter(e => e.type === 'client' && clientUsers.has(e.id));
    clients = stepFor('clients', STEP_TITLES.clients, mine);
    if (!inp.clients.length) clients.evidence.push('No CephClient resources: nothing to move.');
    else clients.evidence.push(`${clients.secure} of ${inp.clients.length} CephClient keys are aes256k.`);
    const missing = inp.clients.filter(c => !mine.some(e => e.id === cephClientUser(c)));
    if (missing.length) clients.evidence.push(`Not in Ceph yet: ${missing.map(c => c.metadata.name).join(', ')}.`);
  }
  const clientPending = inp.clients.filter(c => {
    const w = num(c.spec?.security?.cephx?.keyGeneration);
    const s = num(c.status?.cephx?.keyGeneration);
    return w !== undefined && s !== undefined && w > s;
  });
  if (clientPending.length) clients.pending = `Rook is rotating ${clientPending.map(c => c.metadata.name).join(', ')}.`;

  // 4. RBD mirror peer
  let mirror: LadderStep;
  if (!es) mirror = unknownStep('mirror', STEP_TITLES.mirror);
  else {
    mirror = stepFor('mirror', STEP_TITLES.mirror, es.filter(e => e.kind === 'mirror'));
    mirror.evidence.push(mirror.total ? `client.rbd-mirror-peer is ${mirror.secure ? 'aes256k' : 'aes'}.` : 'No RBD mirror peer key.');
    if (mirror.total && !mirror.secure) mirror.evidence.push('Keep aes while a mirror peer cluster cannot use aes256k (Ceph before 19.2.6 / 20.2.4).');
  }
  const mSpec = obj(spec.rbdMirrorPeer);
  const mGen = num(obj(st.rbdMirrorPeer).keyGeneration);
  if (num(mSpec.keyGeneration) !== undefined && mGen !== undefined && mSpec.keyGeneration > mGen)
    mirror.pending = `Rook is rotating the mirror peer key to generation ${mSpec.keyGeneration} (status: ${mGen}).`;

  // 5. Ciphers
  const allowed = inp.quorum?.allowedCiphers ?? [];
  const specAllowed: string[] = arr<string>(spec.allowedCiphers).map(str);
  const aesAllowed = inp.quorum ? allowed.includes('aes') || checks.has('AUTH_INSECURE_KEYS_ALLOWED') : null;
  const ciphers: LadderStep = {
    id: 'ciphers',
    title: STEP_TITLES.ciphers,
    state: aesAllowed === null ? 'unknown' : aesAllowed ? 'todo' : 'done',
    evidence: [],
    insecure: [],
    total: 0,
    secure: 0,
  };
  if (inp.quorum) ciphers.evidence.push(`Monitors allow ${allowed.length ? allowed.join(' and ') : 'no listed cipher'}; they prefer ${inp.quorum.preferredCipher || '—'}.`);
  else ciphers.evidence.push("Needs Ceph's live state (quorum_status).");
  if (specAllowed.length) ciphers.evidence.push(`The CephCluster sets allowedCiphers: ${specAllowed.join(', ')}.`);
  if (checks.has('AUTH_INSECURE_KEYS_CREATABLE')) ciphers.evidence.push('AUTH_INSECURE_KEYS_CREATABLE: new aes keys can still be created.');
  if (es) {
    const left = es.filter(e => e.keyType === 'aes');
    ciphers.insecure = left.map(e => e.entity);
    if (left.length)
      ciphers.blockedBy = `${left.length} key${left.length === 1 ? ' is' : 's are'} still aes (${left
        .slice(0, 4)
        .map(e => e.entity)
        .join(', ')}${left.length > 4 ? '…' : ''}): Ceph would refuse them once aes is off.`;
  } else ciphers.blockedBy = "Ceph's live state is needed to check every key first.";
  if ((inp.nfsCount ?? 0) > 0 && !ciphers.blockedBy)
    ciphers.evidence.push('CephNFS exports have per-export keys Rook cannot rotate yet: check them before turning aes off.');
  if (aesAllowed && specAllowed.length && !specAllowed.includes('aes')) ciphers.pending = 'Rook is applying allowedCiphers.';

  return [daemon, csi, clients, mirror, ciphers];
}

/** The first step left to do (what the ladder points at), or null when all are done. */
export function nextStep(steps: LadderStep[]): LadderStep | null {
  return steps.find(s => s.state === 'todo' || s.state === 'partial') ?? null;
}

/* ------------------------------------------------------------ builders */

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function withCephx(cluster: Obj, edit: (cx: any) => void): Obj {
  const c = clone(cluster);
  c.spec = c.spec ?? {};
  c.spec.security = c.spec.security ?? {};
  c.spec.security.cephx = c.spec.security.cephx ?? {};
  edit(c.spec.security.cephx);
  return c;
}

/** Step 1: rotate the daemon keys (Rook picks aes256k on Ceph >= 20.2.4 / 19.2.6). */
export function rotateDaemonKeys(cluster: Obj): { after: Obj; generation: number } {
  const gen = daemonGeneration(cluster);
  const cur = num(obj(cephxSpec(cluster).daemon).keyGeneration) ?? 0;
  const generation = Math.max(cur, gen.max ?? 0) + 1;
  const after = withCephx(cluster, cx => {
    const d = { ...(cx.daemon ?? {}) };
    // A daemon keyType of aes (the emergency setting) would rotate to aes again.
    if (d.keyType === 'aes') delete d.keyType;
    cx.daemon = { ...d, keyRotationPolicy: 'KeyGeneration', keyGeneration: generation };
  });
  return { after, generation };
}

/** Step 2: rotate the Ceph-CSI keys to aes256k, keeping `keepPrior` older generations for mounted volumes. */
export function rotateCsiKeys(cluster: Obj, keepPrior = 1): { after: Obj; generation: number } {
  const cur = num(obj(cephxSpec(cluster).csi).keyGeneration) ?? 0;
  const st = num(obj(obj(cluster.status?.cephx).csi).keyGeneration) ?? 0;
  const generation = Math.max(cur, st) + 1;
  const after = withCephx(cluster, cx => {
    cx.csi = { ...(cx.csi ?? {}), keyRotationPolicy: 'KeyGeneration', keyGeneration: generation, keepPriorKeyCountMax: keepPrior, keyType: 'aes256k' };
  });
  return { after, generation };
}

/** Step 2, afterwards: stop keeping prior CSI keys (once every node was drained and uncordoned). */
export function dropPriorCsiKeys(cluster: Obj): Obj {
  return withCephx(cluster, cx => {
    cx.csi = { ...(cx.csi ?? {}), keepPriorKeyCountMax: 0 };
  });
}

/** Step 3: rotate one CephClient's key to aes256k. */
export function rotateClientKey(client: Obj): { after: Obj; generation: number } {
  const c = clone(client);
  const cur = num(c.spec?.security?.cephx?.keyGeneration) ?? 0;
  const st = num(c.status?.cephx?.keyGeneration) ?? 0;
  const generation = Math.max(cur, st) + 1;
  c.spec = c.spec ?? {};
  c.spec.security = c.spec.security ?? {};
  c.spec.security.cephx = { ...(c.spec.security.cephx ?? {}), keyRotationPolicy: 'KeyGeneration', keyGeneration: generation, keyType: 'aes256k' };
  return { after: c, generation };
}

/** Step 4: rotate the RBD mirror peer key to aes256k. */
export function rotateMirrorPeerKey(cluster: Obj): { after: Obj; generation: number } {
  const cur = num(obj(cephxSpec(cluster).rbdMirrorPeer).keyGeneration) ?? 0;
  const st = num(obj(obj(cluster.status?.cephx).rbdMirrorPeer).keyGeneration) ?? 0;
  const generation = Math.max(cur, st) + 1;
  const after = withCephx(cluster, cx => {
    cx.rbdMirrorPeer = { ...(cx.rbdMirrorPeer ?? {}), keyRotationPolicy: 'KeyGeneration', keyGeneration: generation, keyType: 'aes256k' };
  });
  return { after, generation };
}

/** Step 5: only aes256k (Rook runs "ceph mon set auth_allowed_ciphers"). */
export function disallowAes(cluster: Obj): Obj {
  return withCephx(cluster, cx => {
    cx.allowedCiphers = ['aes256k'];
  });
}

/** Rook's documented stopgap: mute health warnings through spec.healthCheck.muteHealthWarning. */
export function muteThroughRook(cluster: Obj, codes: string[], policy: 'mute' | 'unmute' = 'mute'): Obj {
  const c = clone(cluster);
  c.spec = c.spec ?? {};
  c.spec.healthCheck = c.spec.healthCheck ?? {};
  const m = { ...(c.spec.healthCheck.muteHealthWarning ?? {}) };
  for (const code of codes) m[code] = { policy };
  c.spec.healthCheck.muteHealthWarning = m;
  return c;
}

/** The muteHealthWarning policy a CephCluster sets for a code, if any. */
export function rookMutePolicy(cluster: Obj | null, code: string): 'mute' | 'unmute' | null {
  const p = obj(obj(obj(cluster?.spec).healthCheck).muteHealthWarning)[code]?.policy;
  return p === 'mute' || p === 'unmute' ? p : null;
}

/* ------------------------------------------------------- CephClient CRs */

export const CAP_SERVICES = ['mon', 'osd', 'mgr', 'mds'] as const;
export type CapService = (typeof CAP_SERVICES)[number];

export interface CapsPreset {
  id: string;
  label: string;
  help: string;
  /** Needs a pool or file system name. */
  needs?: 'pool' | 'fs';
  caps: (target: string) => Partial<Record<CapService, string>>;
}

export const CAPS_PRESETS: CapsPreset[] = [
  {
    id: 'rbd',
    label: 'RBD pool access',
    help: 'Read and write RBD images in one pool (what a hypervisor or a CSI driver outside Kubernetes needs).',
    needs: 'pool',
    caps: p => ({ mon: 'profile rbd', osd: `profile rbd pool=${p}`, mgr: `profile rbd pool=${p}` }),
  },
  {
    id: 'rbd-ro',
    label: 'RBD read-only',
    help: 'Read RBD images in one pool (backups, exports).',
    needs: 'pool',
    caps: p => ({ mon: 'profile rbd', osd: `profile rbd-read-only pool=${p}`, mgr: `profile rbd pool=${p}` }),
  },
  {
    id: 'cephfs',
    label: 'CephFS mount',
    help: 'Mount one file system read-write.',
    needs: 'fs',
    caps: f => ({ mon: 'allow r', mds: `allow rw fsname=${f}`, osd: `allow rw tag cephfs data=${f}` }),
  },
  {
    id: 'readonly',
    label: 'Cluster read-only',
    help: 'Read status and maps (monitoring tools).',
    caps: () => ({ mon: 'allow r', mgr: 'allow r', osd: 'allow r' }),
  },
];

const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** Problems with a Kubernetes object name (DNS-1123 label), or null. */
export function nameProblem(name: string, max = 63): string | null {
  if (!name) return 'Give it a name.';
  if (name.length > max) return `At most ${max} characters.`;
  if (!NAME_RE.test(name)) return 'Lowercase letters, digits and dashes; start and end with a letter or digit.';
  return null;
}

/** A cap must start with allow or profile (Ceph refuses the rest). */
export function capProblem(cap: string): string | null {
  const c = cap.trim();
  if (!c) return null;
  return /^(allow|profile)\b/.test(c) ? null : 'Caps start with "allow" or "profile".';
}

export function cephClientCR(o: { name: string; namespace: string; caps: Partial<Record<CapService, string>>; keyType?: 'aes256k' }): Obj {
  const caps: Record<string, string> = {};
  for (const s of CAP_SERVICES) {
    const v = (o.caps[s] ?? '').trim();
    if (v) caps[s] = v;
  }
  const cr: Obj = {
    apiVersion: 'ceph.rook.io/v1',
    kind: 'CephClient',
    metadata: { name: o.name, namespace: o.namespace },
    spec: { caps },
  };
  if (o.keyType) cr.spec.security = { cephx: { keyType: o.keyType } };
  return cr;
}

/** The key type of a CephClient: Ceph's (auth) when known, else what Rook reports. */
export function clientKeyType(cr: Obj, entities: CephxEntity[] | null): KeyType {
  const e = entities?.find(x => x.entity === `client.${cephClientUser(cr)}`);
  if (e) return e.keyType;
  return keyTypeOf(cr.status?.cephx?.keyType);
}

/* ------------------------------------------------ CSI readiness checks */

/** "7.3.4-300.fc45.x86_64" → [7, 3]. */
export function kernelVersion(v: string): [number, number] | null {
  const m = str(v).match(/^(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Can this kernel mount with aes256k keys (7.0+; 7.2+ with FIPS)? null when unknown. */
export function kernelReady(v: string, fips = false): boolean | null {
  const k = kernelVersion(v);
  if (!k) return null;
  const [maj, min] = k;
  return fips ? maj > 7 || (maj === 7 && min >= 2) : maj >= 7;
}

/** "quay.io/cephcsi/cephcsi:v3.18.1" → [3, 18, 1]; null for a digest or a non-version tag. */
export function imageVersion(image: string): [number, number, number] | null {
  const tag = str(image).split('@')[0].split(':').pop() ?? '';
  const m = tag.match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** Ceph-CSI 3.17.1 or later? null when the tag says nothing. */
export function cephCsiReady(image: string): boolean | null {
  const v = imageVersion(image);
  if (!v) return null;
  const [a, b, c] = v;
  return a > 3 || (a === 3 && (b > 17 || (b === 17 && c >= 1)));
}

export interface CsiReadiness {
  nodes: { name: string; kernel: string; ready: boolean | null }[];
  images: { image: string; ready: boolean | null }[];
  /** Every node kernel and every cephcsi image is known to be new enough. */
  ready: boolean;
  problems: string[];
}

/** Whether Ceph-CSI keys can move to aes256k: node kernels and cephcsi images. */
export function csiReadiness(nodes: Obj[], pods: Obj[]): CsiReadiness {
  const ns = nodes.map(n => {
    const kernel = str(n.status?.nodeInfo?.kernelVersion);
    return { name: n.metadata.name, kernel, ready: kernelReady(kernel) };
  });
  const imgs = new Set<string>();
  for (const p of pods) for (const c of arr(p.spec?.containers)) if (/\/cephcsi:/.test(str(c.image))) imgs.add(str(c.image));
  const images = [...imgs].map(image => ({ image, ready: cephCsiReady(image) }));
  const problems: string[] = [];
  const oldK = ns.filter(n => n.ready === false);
  if (oldK.length) problems.push(`Kernel older than 7.0 on ${oldK.map(n => `${n.name} (${n.kernel})`).join(', ')}.`);
  const unknownK = ns.filter(n => n.ready === null);
  if (unknownK.length) problems.push(`Kernel version unknown on ${unknownK.map(n => n.name).join(', ')}.`);
  const oldI = images.filter(i => i.ready === false);
  if (oldI.length) problems.push(`Ceph-CSI older than 3.17.1: ${oldI.map(i => i.image).join(', ')}.`);
  if (!images.length) problems.push('No Ceph-CSI pod found in the Rook namespace to check its version.');
  return { nodes: ns, images, ready: problems.length === 0, problems };
}

/** Does this Ceph version ("20.2.4-0", "ceph version 19.2.6 (…)") have aes256k (20.2.4+, 19.2.6+)? null when unknown. */
export function cephHasAes256k(version: string): boolean | null {
  const m = str(version).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a > 20) return true;
  if (a === 20) return b > 2 || (b === 2 && c >= 4);
  if (a === 19) return b > 2 || (b === 2 && c >= 6);
  return false;
}
