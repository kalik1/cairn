/*
 * Pools: who manages each Ceph pool (a CephBlockPool, a CephFilesystem,
 * a CephObjectStore, Rook itself, nobody), which Kubernetes objects use
 * it, the CephBlockPool spec Cairn writes for the create and edit forms,
 * their validation, what a change does to the cluster, and what stands in
 * the way of a delete. Pure functions: views pass in what they read.
 */

import { StateTone } from '../ui/tokens';
import { bytes, count, pct, plural } from './format';
import { CrushBucket, Obj, Osd, PgBrief, Pool } from './types';

/* ------------------------------------------------------------ ownership */

export type OwnerKind = 'CephBlockPool' | 'CephFilesystem' | 'CephObjectStore' | 'CephObjectZone' | 'CephNFS' | 'builtin' | 'unmanaged';

export interface PoolOwner {
  kind: OwnerKind;
  /** The custom resource that owns the pool, when there is one. */
  cr?: Obj;
  /** Its name (or the Ceph filesystem's name for an unmanaged CephFS pool). */
  name?: string;
  /** What the pool holds for that owner: "metadata", "data", "bucket index"… */
  role?: string;
  /** Plain words: who manages it and how to change it. */
  about: string;
}

export interface CephFsEntry {
  name: string;
  metadata_pool: string;
  data_pools: string[];
}

export interface OwnerContext {
  blockPools: Obj[];
  filesystems: Obj[];
  objectStores: Obj[];
  objectZones?: Obj[];
  nfs?: Obj[];
  /** "fs ls": Ceph's own record of which filesystem uses which pools. */
  cephFs?: CephFsEntry[];
}

/** The Ceph pool a CephBlockPool manages (spec.name for .mgr, .nfs, .rgw.root…). */
export function blockPoolName(cr: Obj): string {
  return cr.spec?.name || cr.metadata.name;
}

/** Pools Rook creates for an object store, by suffix after "<store>.". */
const RGW_ROLES: Record<string, string> = {
  'rgw.control': 'control objects',
  'rgw.meta': 'metadata (users, bucket entries)',
  'rgw.log': 'logs and multisite state',
  'rgw.buckets.index': 'bucket indexes',
  'rgw.buckets.non-ec': 'multipart uploads (replicated part)',
  'rgw.otp': 'one-time passwords (MFA)',
  'rgw.buckets.data': 'object data',
};

/** Pool names Rook gives a CephFilesystem, with their role. */
export function filesystemPools(fs: Obj): { name: string; role: string }[] {
  const n = fs.metadata.name;
  const out: { name: string; role: string }[] = [];
  const meta = fs.spec?.metadataPool?.name;
  out.push({ name: meta ? `${n}-${meta}` : `${n}-metadata`, role: 'metadata' });
  (fs.spec?.dataPools ?? []).forEach((p: any, i: number) => {
    out.push({ name: p?.name ? `${n}-${p.name}` : `${n}-data${i}`, role: i === 0 ? 'data (default)' : 'data' });
  });
  return out;
}

const BUILTIN: Record<string, string> = {
  '.mgr': 'Created by Rook for the manager modules (device health, progress…). Define a CephBlockPool with spec.name ".mgr" to manage its settings.',
  '.nfs': 'Holds NFS export and client state for CephNFS servers. Define a CephBlockPool with spec.name ".nfs" to manage its settings.',
  '.nvmeof': 'Holds NVMe-oF gateway state. Define a CephBlockPool with spec.name ".nvmeof" to manage its settings.',
};

/** Who manages a pool. */
export function poolOwner(pool: { id?: number; name: string }, ctx: OwnerContext): PoolOwner {
  const name = pool.name;
  // By name (spec.name or metadata.name), else by the pool id Rook recorded in its status.
  const cbp =
    ctx.blockPools.find(c => blockPoolName(c) === name) ??
    (pool.id !== undefined ? ctx.blockPools.find(c => c.status?.poolID === pool.id && c.status?.phase === 'Ready') : undefined);
  if (cbp) {
    return {
      kind: 'CephBlockPool',
      cr: cbp,
      name: cbp.metadata.name,
      about: `Managed by the CephBlockPool ${cbp.metadata.name}: change it there, Rook applies the change to Ceph.`,
    };
  }
  for (const fs of ctx.filesystems) {
    const hit = filesystemPools(fs).find(p => p.name === name);
    const cephHit = ctx.cephFs?.find(f => f.name === fs.metadata.name && (f.metadata_pool === name || f.data_pools.includes(name)));
    if (hit || cephHit) {
      const role = hit?.role ?? (cephHit?.metadata_pool === name ? 'metadata' : 'data');
      return {
        kind: 'CephFilesystem',
        cr: fs,
        name: fs.metadata.name,
        role,
        about: `The ${role} pool of the CephFilesystem ${fs.metadata.name}: change it in that resource (spec.${role === 'metadata' ? 'metadataPool' : 'dataPools'}).`,
      };
    }
  }
  const fsOnly = ctx.cephFs?.find(f => f.metadata_pool === name || f.data_pools.includes(name));
  if (fsOnly) {
    return {
      kind: 'unmanaged',
      name: fsOnly.name,
      role: fsOnly.metadata_pool === name ? 'metadata' : 'data',
      about: `Used by the Ceph filesystem ${fsOnly.name}, which no CephFilesystem manages: it was created outside Rook.`,
    };
  }
  const zones = ctx.objectZones ?? [];
  for (const [list, kind] of [
    [ctx.objectStores, 'CephObjectStore'],
    [zones, 'CephObjectZone'],
  ] as [Obj[], OwnerKind][]) {
    for (const st of list) {
      const prefix = `${st.metadata.name}.`;
      if (!name.startsWith(prefix)) continue;
      const role = RGW_ROLES[name.slice(prefix.length)];
      if (!role) continue;
      const field = role === 'object data' ? 'spec.dataPool' : 'spec.metadataPool';
      return {
        kind,
        cr: st,
        name: st.metadata.name,
        role,
        about: `Holds ${role} for the ${kind} ${st.metadata.name}: change it in that resource (${field}).`,
      };
    }
  }
  if (name === '.rgw.root') {
    const st = ctx.objectStores[0] ?? zones[0];
    if (st) {
      return {
        kind: st.kind === 'CephObjectZone' ? 'CephObjectZone' : 'CephObjectStore',
        cr: st,
        name: st.metadata.name,
        role: 'realms, zone groups and zones',
        about: 'Holds the realm, zone group and zone configuration shared by every object store. Rook creates it with the first object store.',
      };
    }
    return {
      kind: 'unmanaged',
      role: 'realms, zone groups and zones',
      about:
        'Holds RGW realm and zone configuration, but no CephObjectStore exists: it was created by radosgw-admin or an earlier object store. Rook does not manage it.',
    };
  }
  if (BUILTIN[name]) {
    if (name === '.nfs' && ctx.nfs?.length) {
      return { kind: 'CephNFS', name: ctx.nfs[0].metadata.name, cr: ctx.nfs[0], about: BUILTIN[name] };
    }
    return { kind: 'builtin', about: BUILTIN[name] };
  }
  return {
    kind: 'unmanaged',
    about: 'Created outside Rook (ceph osd pool create, radosgw-admin, another tool). Rook does not manage it, so Cairn shows it read-only.',
  };
}

/** A short label for the owner column. */
export function ownerLabel(o: PoolOwner): string {
  switch (o.kind) {
    case 'CephBlockPool':
    case 'CephFilesystem':
    case 'CephObjectStore':
    case 'CephObjectZone':
    case 'CephNFS':
      return `${o.kind} ${o.name}`;
    case 'builtin':
      return 'Rook (built in)';
    default:
      return o.name ? `Ceph filesystem ${o.name}` : 'Unmanaged';
  }
}

/* ------------------------------------------------------- Kubernetes use */

const CEPH_CSI = /\.(rbd|cephfs|nfs)\.csi\.ceph\.com$/;

export interface ScUse {
  sc: Obj;
  /** How it points at the pool. */
  via: 'pool' | 'dataPool' | 'topology';
}

/** StorageClasses of this Ceph cluster (clusterID) that provision into the pool. */
export function storageClassesUsing(pool: string, scs: Obj[], clusterId?: string): ScUse[] {
  const out: ScUse[] = [];
  for (const sc of scs) {
    if (!CEPH_CSI.test(String(sc.provisioner ?? ''))) continue;
    const p = sc.parameters ?? {};
    if (clusterId && p.clusterID && p.clusterID !== clusterId) continue;
    if (p.pool === pool) out.push({ sc, via: 'pool' });
    else if (p.dataPool === pool) out.push({ sc, via: 'dataPool' });
    else if (typeof p.topologyConstrainedPools === 'string' && topologyPools(p.topologyConstrainedPools).includes(pool))
      out.push({ sc, via: 'topology' });
  }
  return out;
}

function topologyPools(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return (Array.isArray(v) ? v : []).flatMap((e: any) => [e?.poolName, e?.dataPoolName].filter(Boolean));
  } catch {
    return [];
  }
}

/** PersistentVolumes provisioned by Ceph-CSI into the pool (data, metadata or journal). */
export function pvsUsing(pool: string, pvs: Obj[], clusterId?: string): Obj[] {
  return pvs.filter(pv => {
    const csi = pv.spec?.csi;
    if (!csi || !CEPH_CSI.test(String(csi.driver ?? ''))) return false;
    const a = csi.volumeAttributes ?? {};
    if (clusterId && a.clusterID && a.clusterID !== clusterId) return false;
    return a.pool === pool || a.dataPool === pool || a.journalPool === pool;
  });
}

/** Snapshot classes of the same Ceph-CSI drivers and Ceph cluster as these StorageClasses. */
export function snapshotClassesFor(uses: ScUse[], classes: Obj[], clusterId?: string): Obj[] {
  const drivers = new Set(uses.map(u => u.sc.provisioner));
  return classes.filter(c => drivers.has(c.driver) && (!clusterId || !c.parameters?.clusterID || c.parameters.clusterID === clusterId));
}

/* -------------------------------------------------------- PGs and state */

/** Tone of one PG state ("active+clean", "active+undersized+degraded"…). */
export function pgTone(state: string): StateTone {
  const s = state.split('+');
  const has = (...x: string[]) => x.some(v => s.includes(v));
  if (has('inconsistent', 'down', 'incomplete', 'stale', 'unknown', 'snaptrim_error', 'backfill_toofull', 'recovery_toofull', 'recovery_unfound', 'backfill_unfound'))
    return 'err';
  if (!s.includes('active')) return has('creating', 'peering', 'activating', 'peered') ? 'move' : 'err';
  if (has('degraded', 'undersized', 'repair')) return 'warn';
  if (s.some(x => /^(backfill|recover|remapped|forced|premerge|snaptrim|scrubbing|deep)/.test(x))) return 'move';
  if (s.includes('clean')) return 'ok';
  return 'warn';
}

export interface PgCount {
  state: string;
  count: number;
  tone: StateTone;
}

/** PG states of one pool, worst first. */
export function poolPgStates(pgs: PgBrief[], poolId: number): PgCount[] {
  const by = new Map<string, number>();
  for (const p of pgs) if (p.pool === poolId) by.set(p.state, (by.get(p.state) ?? 0) + 1);
  const rank: Record<StateTone, number> = { err: 0, warn: 1, move: 2, idle: 3, ok: 4 };
  return [...by.entries()]
    .map(([state, n]) => ({ state, count: n, tone: pgTone(state) }))
    .sort((a, b) => rank[a.tone] - rank[b.tone] || b.count - a.count);
}

/** One word for a pool's condition, from its flags and PGs. */
export function poolState(pool: Pool, pgs: PgBrief[]): { tone: StateTone; word: string; detail: string } {
  const states = poolPgStates(pgs, pool.id);
  const total = states.reduce((n, s) => n + s.count, 0);
  if (pool.flags.includes('full_quota')) return { tone: 'err', word: 'Quota reached', detail: 'Writes are refused until data is removed or the quota is raised.' };
  if (pool.flags.includes('full')) return { tone: 'err', word: 'Full', detail: 'The OSDs it uses are full: writes are refused.' };
  const n = (tone: StateTone) => states.filter(s => s.tone === tone).reduce((x, s) => x + s.count, 0);
  if (n('err')) return { tone: 'err', word: `${n('err')} PG${n('err') > 1 ? 's' : ''} inactive or damaged`, detail: 'Some data cannot be read or written.' };
  if (pool.flags.includes('nearfull') || pool.flags.includes('backfillfull'))
    return { tone: 'warn', word: 'Near full', detail: 'The OSDs it uses are near their full ratio.' };
  if (n('warn')) return { tone: 'warn', word: 'Degraded', detail: `${n('warn')} of ${total} PGs have fewer copies than they should.` };
  if (n('move')) {
    const scrubOnly = states.filter(s => s.tone === 'move').every(s => /scrub/.test(s.state) && !/backfill|recover|remapped/.test(s.state));
    return scrubOnly
      ? { tone: 'ok', word: 'Clean, scrubbing', detail: 'Ceph is checking data consistency.' }
      : { tone: 'move', word: 'Moving data', detail: `${n('move')} PGs are recovering or backfilling.` };
  }
  if (!total) return { tone: 'idle', word: 'No PG data', detail: 'The PG list has not been read yet.' };
  return { tone: 'ok', word: 'Clean', detail: `All ${total} PGs are active and clean.` };
}

/** "Replicated, 3 copies (min 2)" / "Erasure coded 4+2". */
export function typeLabel(p: Pool): string {
  if (p.type === 'erasure') return p.ec ? `Erasure coded ${p.ec.k}+${p.ec.m}` : 'Erasure coded';
  return `Replicated, ${plural(p.size, 'copy', 'copies')} (min ${p.minSize})`;
}

/* -------------------------------------------------- failure domains */

/**
 * How many CRUSH buckets of each type under `root` hold at least one
 * in OSD of `deviceClass` ("" = any): how many failure domains a pool on
 * that rule can spread over. "osd" counts the OSDs.
 */
export function domainCounts(buckets: CrushBucket[], osds: Osd[], deviceClass = '', root = 'default'): Record<string, number> {
  const byId = new Map(buckets.map(b => [b.id, b]));
  const osdBy = new Map(osds.map(o => [o.id, o]));
  const good = (id: number) => {
    const o = osdBy.get(id);
    return !!o && o.in && (!deviceClass || o.deviceClass === deviceClass);
  };
  const memo = new Map<number, boolean>();
  const has = (id: number): boolean => {
    if (id >= 0) return good(id);
    const m = memo.get(id);
    if (m !== undefined) return m;
    memo.set(id, false);
    const v = (byId.get(id)?.children ?? []).some(has);
    memo.set(id, v);
    return v;
  };
  const top = buckets.find(b => b.name === root) ?? buckets.find(b => b.type === 'root');
  const under = new Set<number>();
  const walk = (id: number) => {
    if (under.has(id)) return;
    under.add(id);
    for (const c of byId.get(id)?.children ?? []) walk(c);
  };
  if (top) walk(top.id);
  else buckets.forEach(b => walk(b.id));
  const out: Record<string, number> = { osd: 0 };
  for (const id of under) {
    if (id >= 0) {
      if (good(id)) out.osd++;
      continue;
    }
    const b = byId.get(id);
    if (!b || b.type === 'root' || !has(id)) continue;
    out[b.type] = (out[b.type] ?? 0) + 1;
  }
  return out;
}

/** Failure-domain types worth offering, most common first. */
export function domainTypes(counts: Record<string, number>): string[] {
  const order = ['host', 'osd', 'rack', 'row', 'room', 'datacenter', 'zone', 'region', 'chassis', 'pod', 'pdu'];
  const extra = Object.keys(counts).filter(k => !order.includes(k));
  return [...order.filter(k => k === 'host' || k === 'osd' || counts[k]), ...extra];
}

/* ------------------------------------------------------------ the form */

export type Compression = 'none' | 'passive' | 'aggressive' | 'force';
export type AutoscaleMode = 'on' | 'warn' | 'off';

export interface PoolForm {
  name: string;
  type: 'replicated' | 'erasure';
  size: number;
  k: number;
  m: number;
  failureDomain: string;
  /** "" = any device class. */
  deviceClass: string;
  compression: Compression;
  /** "" = Ceph's default algorithm. */
  compressionAlgorithm: string;
  /** "" = no quota; a Kubernetes quantity ("100Gi", "1T"). */
  quotaMaxSize: string;
  /** "" = no quota. */
  quotaMaxObjects: string;
  /** "rbd" is Rook's default for a CephBlockPool. */
  application: string;
  /** "" = no hint. */
  targetSizeRatio: string;
  autoscale: AutoscaleMode;
  rbdStats: boolean;
}

export function defaultPoolForm(): PoolForm {
  return {
    name: '',
    type: 'replicated',
    size: 3,
    k: 2,
    m: 1,
    failureDomain: 'host',
    deviceClass: '',
    compression: 'none',
    compressionAlgorithm: '',
    quotaMaxSize: '',
    quotaMaxObjects: '',
    application: 'rbd',
    targetSizeRatio: '',
    autoscale: 'on',
    rbdStats: false,
  };
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** The form for an existing CephBlockPool. */
export function formFromCr(cr: Obj): PoolForm {
  const s = cr.spec ?? {};
  const p = s.parameters ?? {};
  const ec = !!s.erasureCoded && !s.replicated?.size;
  const maxSize = s.quotas?.maxSize ?? (s.quotas?.maxBytes ? String(s.quotas.maxBytes) : '');
  return {
    name: cr.metadata.name,
    type: ec ? 'erasure' : 'replicated',
    size: Number(s.replicated?.size ?? 3),
    k: Number(s.erasureCoded?.dataChunks ?? 2),
    m: Number(s.erasureCoded?.codingChunks ?? 1),
    failureDomain: s.failureDomain || 'host',
    deviceClass: s.deviceClass ?? '',
    compression: (p.compression_mode || s.compressionMode || 'none') as Compression,
    compressionAlgorithm: p.compression_algorithm ?? '',
    quotaMaxSize: maxSize === '0' ? '' : str(maxSize),
    quotaMaxObjects: s.quotas?.maxObjects ? String(s.quotas.maxObjects) : '',
    application: s.application || 'rbd',
    targetSizeRatio: str(ec ? p.target_size_ratio : s.replicated?.targetSizeRatio ?? p.target_size_ratio),
    autoscale: (p.pg_autoscale_mode || 'on') as AutoscaleMode,
    rbdStats: !!s.enableRBDStats,
  };
}

/** Kubernetes quantity → bytes ("10Gi", "10G", "1.5T", "512"). null when not a quantity. */
export function parseQuantity(q: string): number | null {
  const m = q.trim().match(/^([0-9]+\.?[0-9]*)([KMGTPE]i|[kMGTPE])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2] ?? '';
  const dec: Record<string, number> = { '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };
  const bin = (i: number) => Math.pow(1024, i);
  const v = u.endsWith('i') ? n * bin('KMGTPE'.indexOf(u[0]) + 1) : n * dec[u];
  return isFinite(v) ? Math.round(v) : null;
}

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

function setOrDelete(o: Record<string, any>, key: string, v: unknown) {
  if (v === undefined || v === '' || v === null) delete o[key];
  else o[key] = v;
}

/**
 * The CephBlockPool for the form. With `base` (edit) every field Cairn
 * does not manage is kept as it is (mirroring, status checks, CRUSH root,
 * hybrid storage…).
 */
export function buildBlockPool(f: PoolForm, namespace: string, base?: Obj): Obj {
  const o: Obj = base
    ? clone(base)
    : { apiVersion: 'ceph.rook.io/v1', kind: 'CephBlockPool', metadata: { name: f.name.trim(), namespace }, spec: {} };
  delete o.status;
  const s: Record<string, any> = (o.spec = o.spec ?? {});
  const had = base?.spec ?? {};
  const params: Record<string, string> = { ...(s.parameters ?? {}) };

  s.failureDomain = f.failureDomain || 'host';
  setOrDelete(s, 'deviceClass', f.deviceClass);

  const ratio = f.targetSizeRatio.trim() === '' ? undefined : Number(f.targetSizeRatio);
  if (f.type === 'replicated') {
    const r: Record<string, any> = { ...(s.replicated ?? {}), size: f.size };
    if (f.size === 1) r.requireSafeReplicaSize = false;
    else if (r.requireSafeReplicaSize === false || !base) r.requireSafeReplicaSize = true;
    setOrDelete(r, 'targetSizeRatio', ratio);
    s.replicated = r;
    delete s.erasureCoded;
    if (!had.replicated?.targetSizeRatio) delete params.target_size_ratio;
  } else {
    s.erasureCoded = { ...(s.erasureCoded ?? {}), dataChunks: f.k, codingChunks: f.m };
    delete s.replicated;
    setOrDelete(params, 'target_size_ratio', ratio === undefined ? undefined : String(ratio));
  }

  // Compression: written as a parameter (spec.compressionMode is deprecated).
  if (f.compression !== 'none' || params.compression_mode || s.compressionMode) params.compression_mode = f.compression;
  delete s.compressionMode;
  setOrDelete(params, 'compression_algorithm', f.compression === 'none' ? '' : f.compressionAlgorithm);
  if (f.autoscale !== 'on' || params.pg_autoscale_mode) params.pg_autoscale_mode = f.autoscale;
  if (Object.keys(params).length) s.parameters = params;
  else delete s.parameters;

  // Quotas: clearing one writes 0 (Ceph's "no quota") so Rook removes it.
  const q: Record<string, any> = { ...(s.quotas ?? {}) };
  delete q.maxBytes;
  const size = f.quotaMaxSize.trim();
  const objs = f.quotaMaxObjects.trim();
  const hadSize = !!(had.quotas?.maxSize && had.quotas.maxSize !== '0') || !!had.quotas?.maxBytes;
  const hadObjs = !!had.quotas?.maxObjects;
  setOrDelete(q, 'maxSize', size || (hadSize ? '0' : undefined));
  setOrDelete(q, 'maxObjects', objs ? Number(objs) : hadObjs ? 0 : undefined);
  if (Object.keys(q).length) s.quotas = q;
  else delete s.quotas;

  setOrDelete(s, 'application', f.application && f.application !== 'rbd' ? f.application : had.application ? f.application : undefined);
  if (f.rbdStats) s.enableRBDStats = true;
  else if (had.enableRBDStats) s.enableRBDStats = false;
  else delete s.enableRBDStats;
  return o;
}

/* ------------------------------------------------------- validation */

export interface Problem {
  field: keyof PoolForm | 'general';
  level: 'error' | 'warn';
  text: string;
}

export interface FormContext {
  /** Ceph pool names that exist. */
  cephPools: string[];
  /** CephBlockPool names in the namespace. */
  crs: string[];
  /** Failure domains per type for the chosen device class. */
  domains: Record<string, number>;
  deviceClasses: string[];
}

const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** Problems with the form; errors block the change. */
export function poolProblems(f: PoolForm, ctx: FormContext, mode: 'create' | 'edit', before?: PoolForm): Problem[] {
  const out: Problem[] = [];
  const err = (field: Problem['field'], text: string) => out.push({ field, level: 'error', text });
  const warn = (field: Problem['field'], text: string) => out.push({ field, level: 'warn', text });
  const name = f.name.trim();
  if (mode === 'create') {
    if (!name) err('name', 'Give the pool a name.');
    else if (name.length > 63) err('name', 'Use at most 63 characters.');
    else if (!NAME_RE.test(name)) err('name', 'Use lowercase letters, digits and dashes; start and end with a letter or digit.');
    else if (ctx.crs.includes(name)) err('name', `A CephBlockPool named ${name} already exists.`);
    else if (ctx.cephPools.includes(name))
      err('name', `Ceph already has a pool named ${name}. A CephBlockPool with this name would take it over and change its settings: pick another name.`);
  }
  const need = f.type === 'replicated' ? f.size : f.k + f.m;
  const have = ctx.domains[f.failureDomain] ?? 0;
  if (f.type === 'replicated') {
    if (!Number.isInteger(f.size) || f.size < 1 || f.size > 10) err('size', 'Copies must be a whole number from 1 to 10.');
    else if (f.size === 1) warn('size', 'One copy means no redundancy: losing one disk loses data in this pool.');
    else if (f.size === 2) warn('size', 'Two copies (min 1 to write) risk data loss when a disk fails during recovery; 3 is the safe default.');
  } else {
    if (!Number.isInteger(f.k) || f.k < 2) err('k', 'Data chunks (k) must be at least 2.');
    if (!Number.isInteger(f.m) || f.m < 1) err('m', 'Coding chunks (m) must be at least 1.');
    if (f.m === 1 && f.k >= 2) warn('m', 'With m = 1 one failure leaves no margin: the pool stops accepting writes until recovery (min_size is k+1).');
  }
  if (have < need)
    err(
      'failureDomain',
      `${need} ${f.type === 'replicated' ? 'copies' : 'chunks'} need ${need} separate ${f.failureDomain === 'osd' ? 'OSDs' : `${f.failureDomain}s`}${
        f.deviceClass ? ` with ${f.deviceClass} OSDs` : ''
      }; the cluster has ${have}. PGs would stay undersized.`
    );
  if (f.deviceClass && !ctx.deviceClasses.includes(f.deviceClass)) err('deviceClass', `No OSD has the device class ${f.deviceClass}.`);
  if (f.quotaMaxSize.trim() && parseQuantity(f.quotaMaxSize) === null)
    err('quotaMaxSize', 'Write a size like 100Gi (binary) or 100G (decimal).');
  if (f.quotaMaxObjects.trim() && !/^[0-9]+$/.test(f.quotaMaxObjects.trim())) err('quotaMaxObjects', 'Write a whole number of objects.');
  if (f.targetSizeRatio.trim() && !(Number(f.targetSizeRatio) >= 0)) err('targetSizeRatio', 'Write a number of 0 or more, like 0.2.');
  if (!f.application.trim()) err('application', 'Name the application (rbd for block images).');
  if (mode === 'edit' && before) {
    if (before.type !== f.type) err('type', 'Ceph cannot change a pool between replicated and erasure coded.');
    if (f.type === 'erasure' && (before.k !== f.k || before.m !== f.m))
      err('k', 'k and m of an erasure-coded pool are fixed when it is created: create a new pool and move the data.');
    if (before.application !== f.application) warn('application', 'Changing the application tag does not move data, but clients that check it may refuse the pool.');
  }
  return out;
}

/* ------------------------------------------------------------ impact */

export interface ImpactContext {
  domains: Record<string, number>;
  /** In OSDs the pool would use. */
  osds: number;
  /** Raw bytes free and total on those OSDs. */
  rawAvail: number;
  rawTotal: number;
  fullRatio: number;
  /** osd_pool_default_pg_num (32). */
  defaultPgNum: number;
  /** mon_max_pg_per_osd (250). */
  maxPgPerOsd: number;
  /** The most PGs one of those OSDs holds today. */
  maxPgsNow: number;
}

export interface Line {
  tone: StateTone;
  text: string;
}

export interface CreateImpact {
  rawPerByte: number;
  needDomains: number;
  haveDomains: number;
  /** Bytes the pool could store now, at most (shared with every other pool on these OSDs). */
  usable: number;
  pgs: number;
  pgPerOsdAfter: number;
  lines: Line[];
}

export const rawFactorOf = (f: Pick<PoolForm, 'type' | 'size' | 'k' | 'm'>) => (f.type === 'replicated' ? Math.max(1, f.size) : (f.k + f.m) / Math.max(1, f.k));

/** What creating this pool does. */
export function createImpact(f: PoolForm, c: ImpactContext): CreateImpact {
  const raw = rawFactorOf(f);
  const width = f.type === 'replicated' ? f.size : f.k + f.m;
  const pgs = c.defaultPgNum;
  const perOsd = c.osds > 0 ? (pgs * width) / c.osds : 0;
  const after = c.maxPgsNow + perOsd;
  const usable = Math.max(0, (c.rawAvail - (1 - c.fullRatio) * c.rawTotal) / raw);
  const need = width;
  const have = c.domains[f.failureDomain] ?? 0;
  const lines: Line[] = [];
  lines.push({
    tone: 'idle',
    text:
      f.type === 'replicated'
        ? `Every stored byte takes ${raw} bytes of raw space (${plural(f.size, 'copy', 'copies')}).`
        : `Every stored byte takes ${raw.toFixed(2)} bytes of raw space (${f.k} data + ${f.m} coding chunks); it survives ${plural(f.m, 'failure')} of the failure domain.`,
  });
  lines.push({
    tone: have >= need ? 'ok' : 'err',
    text: `Needs ${need} ${f.failureDomain === 'osd' ? 'OSDs' : `${f.failureDomain}s`}${f.deviceClass ? ` with ${f.deviceClass} OSDs` : ''}; the cluster has ${have}.`,
  });
  lines.push({ tone: 'idle', text: `Room for at most ${bytes(usable)} of data now, shared with the other pools on the same OSDs.` });
  lines.push({
    tone: after > c.maxPgPerOsd ? 'err' : after > c.maxPgPerOsd * 0.8 ? 'warn' : 'idle',
    text:
      f.autoscale === 'on'
        ? `Rook creates it with one PG and the autoscaler soon raises it to about ${pgs}: about ${Math.round(perOsd)} more PG copies per OSD, up to ${Math.round(after)} of the ${c.maxPgPerOsd} allowed.`
        : `Rook creates it with one PG and it stays there (autoscaler ${f.autoscale}) until you raise pg_num; at ${pgs} PGs each OSD would hold about ${Math.round(after)} of the ${c.maxPgPerOsd} allowed.`,
  });
  if (after > c.maxPgPerOsd)
    lines.push({ tone: 'err', text: 'Ceph refuses pools that would put more PGs on an OSD than mon_max_pg_per_osd allows.' });
  return { rawPerByte: raw, needDomains: need, haveDomains: have, usable, pgs, pgPerOsdAfter: after, lines };
}

/** What changing an existing pool does. */
export function editImpact(
  before: PoolForm,
  after: PoolForm,
  usage?: { stored: number; objects: number }
): { lines: Line[]; movesData: boolean; danger: boolean } {
  const lines: Line[] = [];
  let moves = false;
  let danger = false;
  const stored = usage?.stored ?? 0;
  if (before.type === 'replicated' && after.size !== before.size) {
    const delta = (after.size - before.size) * stored;
    if (after.size > before.size) {
      moves = true;
      lines.push({ tone: 'move', text: `Ceph writes ${plural(after.size - before.size, 'more copy', 'more copies')} of every object: about ${bytes(delta)} more raw space, and data moves (backfill) until it is done.` });
    } else {
      lines.push({ tone: 'warn', text: `Ceph removes ${plural(before.size - after.size, 'copy', 'copies')} of every object (frees about ${bytes(-delta)} raw): the pool survives fewer failures.` });
    }
    if (after.size === 1) {
      danger = true;
      lines.push({ tone: 'err', text: 'With one copy, any failed disk loses data in this pool.' });
    }
  }
  if (after.failureDomain !== before.failureDomain || after.deviceClass !== before.deviceClass) {
    moves = true;
    lines.push({
      tone: 'move',
      text: `Rook switches the pool to a new CRUSH rule (${after.failureDomain}${after.deviceClass ? `, ${after.deviceClass}` : ''}): placement changes and up to all ${bytes(stored * rawFactorOf(before))} of raw data moves.`,
    });
  }
  if (after.compression !== before.compression || after.compressionAlgorithm !== before.compressionAlgorithm)
    lines.push({ tone: 'idle', text: `Compression becomes ${after.compression}${after.compressionAlgorithm ? ` (${after.compressionAlgorithm})` : ''}: it applies to new writes only; data already stored stays as written.` });
  const qb = parseQuantity(after.quotaMaxSize) ?? 0;
  if (after.quotaMaxSize !== before.quotaMaxSize) {
    if (!after.quotaMaxSize.trim()) lines.push({ tone: 'idle', text: 'The size quota is removed.' });
    else if (qb <= stored) {
      danger = true;
      lines.push({ tone: 'err', text: `The pool already stores ${bytes(stored)}, more than the new quota of ${bytes(qb)}: Ceph refuses every write at once.` });
    } else lines.push({ tone: 'idle', text: `Writes are refused once the pool stores ${bytes(qb)} (now ${bytes(stored)}, ${pct(stored / qb)}).` });
  }
  if (after.quotaMaxObjects !== before.quotaMaxObjects) {
    const qo = Number(after.quotaMaxObjects || 0);
    if (!after.quotaMaxObjects.trim()) lines.push({ tone: 'idle', text: 'The object quota is removed.' });
    else if (usage && qo <= usage.objects) {
      danger = true;
      lines.push({ tone: 'err', text: `The pool already holds ${count(usage.objects)} objects, more than the new quota of ${count(qo)}: writes stop at once.` });
    } else lines.push({ tone: 'idle', text: `Writes are refused once the pool holds ${count(qo)} objects.` });
  }
  if (after.targetSizeRatio !== before.targetSizeRatio || after.autoscale !== before.autoscale)
    lines.push({ tone: 'move', text: 'The PG autoscaler may change pg_num; data moves while PGs split or merge.' });
  if (after.rbdStats !== before.rbdStats)
    lines.push({ tone: 'idle', text: after.rbdStats ? 'The mgr starts collecting per-image I/O statistics (a little more mgr load).' : 'Per-image I/O statistics stop.' });
  if (after.application !== before.application) lines.push({ tone: 'warn', text: `The application tag becomes ${after.application}.` });
  return { lines, movesData: moves, danger };
}

/* ------------------------------------------------------------ delete */

export interface DeleteInput {
  pool: string;
  owner: PoolOwner;
  storageClasses: ScUse[];
  pvs: Obj[];
  /** RBD images in the pool (all namespaces); null when they could not be listed. */
  images: string[] | null;
  /** Images in the RBD trash. */
  trash: number;
  /** CephBlockPoolRadosNamespaces in the pool. */
  radosNamespaces: Obj[];
  /** Object stores using it as a shared pool. */
  objectStores: Obj[];
  /** Why the images could not be listed. */
  listError?: string;
}

/** What stands in the way of deleting a pool, in words (empty = it may go). */
export function deleteBlockers(d: DeleteInput): string[] {
  const out: string[] = [];
  if (d.owner.kind !== 'CephBlockPool') {
    out.push(`${d.owner.about} Cairn deletes only pools a CephBlockPool owns.`);
    return out;
  }
  const names = (xs: string[]) => (xs.length > 5 ? `${xs.slice(0, 5).join(', ')} and ${xs.length - 5} more` : xs.join(', '));
  if (d.storageClasses.length)
    out.push(
      `StorageClass${d.storageClasses.length > 1 ? 'es' : ''} ${names(d.storageClasses.map(u => u.sc.metadata.name))} ${
        d.storageClasses.length > 1 ? 'provision' : 'provisions'
      } volumes into it: delete or change ${d.storageClasses.length > 1 ? 'them' : 'it'} first.`
    );
  if (d.pvs.length)
    out.push(
      `${plural(d.pvs.length, 'PersistentVolume')} ${d.pvs.length > 1 ? 'live' : 'lives'} in it (${names(
        d.pvs.map(pv => (pv.spec?.claimRef ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}` : pv.metadata.name))
      )}): delete those claims first.`
    );
  if (d.images === null) out.push(`Cairn could not list the RBD images in it${d.listError ? ` (${d.listError})` : ''}: try again when Ceph answers.`);
  else if (d.images.length) out.push(`It still has ${plural(d.images.length, 'RBD image')} (${names(d.images)}): remove ${d.images.length > 1 ? 'them' : 'it'} first.`);
  if (d.trash) out.push(`${plural(d.trash, 'image')} ${d.trash > 1 ? 'are' : 'is'} in its RBD trash: purge the trash first.`);
  if (d.radosNamespaces.length)
    out.push(`CephBlockPoolRadosNamespace ${names(d.radosNamespaces.map(r => r.metadata.name))} ${d.radosNamespaces.length > 1 ? 'live' : 'lives'} in it: delete ${d.radosNamespaces.length > 1 ? 'them' : 'it'} first.`);
  if (d.objectStores.length)
    out.push(`Object store ${names(d.objectStores.map(o => o.metadata.name))} ${d.objectStores.length > 1 ? 'use' : 'uses'} it as a shared pool.`);
  return out;
}

/** Object stores that use the pool as a shared metadata or data pool. */
export function objectStoresSharing(pool: string, stores: Obj[]): Obj[] {
  return stores.filter(s => {
    const sp = s.spec?.sharedPools ?? {};
    return sp.metadataPoolName === pool || sp.dataPoolName === pool || (sp.poolPlacements ?? []).some((p: any) => p?.metadataPoolName === pool || p?.dataPoolName === pool || p?.dataNonECPoolName === pool);
  });
}

/** CephBlockPoolRadosNamespaces whose pool is this CephBlockPool. */
export function radosNamespacesOf(cr: Obj | undefined, list: Obj[]): Obj[] {
  if (!cr) return [];
  return list.filter(r => r.spec?.blockPoolName === cr.metadata.name && r.metadata.namespace === cr.metadata.namespace);
}

/* ----------------------------------------------------- capacity strata */

export interface Strata {
  /** Raw bytes: stored data, replication/EC overhead, free space the pool can still use. */
  stored: number;
  overhead: number;
  free: number;
  total: number;
  /** Raw position of the quota, when one is set. */
  quotaAt: number | null;
  /** Raw position where the cluster reaches its near-full ratio (approximate). */
  nearFullAt: number | null;
}

/**
 * The pool's raw capacity section: what it stores, what the copies or
 * coding chunks cost, and the raw space it may still fill (Ceph's
 * max_avail, which already stops at the full ratio).
 */
export function poolStrata(p: Pool, cluster: { total: number; usedRaw: number; nearFullRatio: number; fullRatio: number }): Strata | null {
  const u = p.usage;
  if (!u) return null;
  const used = u.used || u.storedRaw;
  const stored = Math.min(u.stored, used);
  const overhead = Math.max(0, used - stored);
  const free = Math.max(0, u.maxAvail * p.rawFactor);
  const total = used + free;
  const quota = p.quotaBytes || u.quotaBytes;
  const quotaAt = quota > 0 ? quota * p.rawFactor : null;
  // max_avail stops at the full ratio; the near-full point comes that many bytes of the cluster earlier.
  const margin = (cluster.fullRatio - cluster.nearFullRatio) * cluster.total;
  const nearFullAt = cluster.total > 0 ? Math.max(0, used + free - margin) : null;
  return { stored, overhead, free, total, quotaAt, nearFullAt };
}
