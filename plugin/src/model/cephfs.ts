/*
 * CephFS: file systems and their metadata servers (fs dump, fs status),
 * subvolume groups and subvolumes (the mgr volumes module), the
 * Kubernetes volumes Ceph-CSI made from them, and the Rook resources that
 * create them (CephFilesystem, CephFilesystemSubVolumeGroup).
 */

import { Obj } from './types';

const obj = (v: unknown): any => (v && typeof v === 'object' ? v : {});
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return isFinite(n) ? n : d;
};

function cephTimeMs(v: unknown): number | null {
  let s = str(v).trim();
  if (!s) return null;
  s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2').replace(/T(\d{2}:\d{2}:\d{2}):(\d+)/, 'T$1.$2').replace(/\.(\d{3})\d+/, '.$1');
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
  // Ceph prints the volumes module times without a zone: they are UTC (the mgr container's clock).
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

/* ----------------------------------------------------------- fs dump */

export interface MdsDaemon {
  gid: number;
  name: string;
  /** -1 for a standby. */
  rank: number;
  /** "active", "standby-replay", "standby", "replay", "rejoin"… ("up:" dropped). */
  state: string;
  addr: string;
  /** The file system it wants to join (mds_join_fs), -1 for any. */
  joinFscid: number;
}

export interface FsRank {
  rank: number;
  /** State of the MDS holding it, "failed" or "damaged" when none. */
  state: string;
  mds?: string;
  /** From fs status: requests per second, dentries, inodes, dirs, caps. */
  rate?: number;
  dns?: number;
  inos?: number;
  dirs?: number;
  caps?: number;
}

export interface CephFs {
  id: number;
  name: string;
  epoch: number;
  created: number | null;
  modified: number | null;
  enabled: boolean;
  maxMds: number;
  ranks: FsRank[];
  /** Standby-replay daemons following a rank. */
  replay: MdsDaemon[];
  metadataPool: number;
  dataPools: number[];
  joinable: boolean;
  allowStandbyReplay: boolean;
  refuseClientSession: boolean;
  standbyWanted: number;
  failed: number[];
  damaged: number[];
  /** From fs status. */
  clients?: number;
  /** Ceph's MDS versions (fs status). */
  versions?: string[];
}

export interface FsMap {
  epoch: number;
  filesystems: CephFs[];
  /** Standbys of the whole cluster (any file system may take them). */
  standbys: MdsDaemon[];
}

const dropUp = (s: string) => s.replace(/^up:/, '');

function mds(raw: any): MdsDaemon {
  return {
    gid: num(raw.gid),
    name: str(raw.name),
    rank: num(raw.rank, -1),
    state: dropUp(str(raw.state)),
    addr: str(raw.addr).replace(/\/\d+$/, ''),
    joinFscid: num(raw.join_fscid, -1),
  };
}

/** "fs dump" (mon): every file system with its ranks, standby-replay daemons and pools; the standbys. */
export function parseFsDump(raw: any): FsMap {
  const d = obj(raw);
  const filesystems = arr(d.filesystems).map((f: any) => {
    const m = obj(f.mdsmap);
    const daemons = Object.values(obj(m.info)).map(mds);
    const failed = arr<number>(m.failed).map(Number);
    const damaged = arr<number>(m.damaged).map(Number);
    const inRanks = arr<number>(m.in).map(Number);
    const active = daemons.filter(x => x.rank >= 0 && x.state !== 'standby-replay');
    const ranks: FsRank[] = inRanks
      .sort((a, b) => a - b)
      .map(r => {
        const holder = active.find(x => x.rank === r);
        if (holder) return { rank: r, state: holder.state, mds: holder.name };
        return { rank: r, state: damaged.includes(r) ? 'damaged' : 'failed' };
      });
    const flags = obj(m.flags_state);
    return {
      id: num(f.id),
      name: str(m.fs_name),
      epoch: num(m.epoch),
      created: cephTimeMs(m.created),
      modified: cephTimeMs(m.modified),
      enabled: m.enabled !== false,
      maxMds: num(m.max_mds, 1),
      ranks,
      replay: daemons.filter(x => x.state === 'standby-replay'),
      metadataPool: num(m.metadata_pool, -1),
      dataPools: arr(m.data_pools).map(Number),
      joinable: flags.joinable !== false,
      allowStandbyReplay: !!flags.allow_standby_replay,
      refuseClientSession: !!flags.refuse_client_session,
      standbyWanted: num(m.standby_count_wanted),
      failed,
      damaged,
    } as CephFs;
  });
  return { epoch: num(d.epoch), filesystems, standbys: arr(d.standbys).map(mds) };
}

export interface FsStatus {
  clients: number;
  ranks: Map<number, { rate: number; dns: number; inos: number; dirs: number; caps: number; name: string; state: string }>;
  pools: { id: number; name: string; type: 'metadata' | 'data'; used: number; avail: number }[];
  versions: string[];
}

/** "fs status fs=<name>" (mgr): client count, per-rank activity, pool usage. */
export function parseFsStatus(raw: any, fsName?: string): FsStatus {
  const d = obj(raw);
  const clientsRow = arr(d.clients).find((c: any) => !fsName || str(c.fs) === fsName) ?? arr(d.clients)[0];
  const ranks: FsStatus['ranks'] = new Map();
  for (const m of arr(d.mdsmap)) {
    if (typeof m.rank !== 'number' || str(m.state) === 'standby-replay' || str(m.state) === 'standby') continue;
    ranks.set(m.rank, {
      rate: num(m.rate),
      dns: num(m.dns),
      inos: num(m.inos),
      dirs: num(m.dirs),
      caps: num(m.caps),
      name: str(m.name),
      state: str(m.state),
    });
  }
  return {
    clients: num(obj(clientsRow).clients),
    ranks,
    pools: arr(d.pools).map((p: any) => ({
      id: num(p.id),
      name: str(p.name),
      type: str(p.type) === 'metadata' ? 'metadata' : 'data',
      used: num(p.used),
      avail: num(p.avail),
    })),
    versions: arr(d.mds_version).map((v: any) => str(v.version)),
  };
}

/** A file system with its fs status merged in. */
export function withStatus(fs: CephFs, st: FsStatus | null | undefined): CephFs {
  if (!st) return fs;
  return {
    ...fs,
    clients: st.clients,
    versions: st.versions,
    ranks: fs.ranks.map(r => {
      const s = st.ranks.get(r.rank);
      return s ? { ...r, rate: s.rate, dns: s.dns, inos: s.inos, dirs: s.dirs, caps: s.caps } : r;
    }),
  };
}

/** Standbys that belong to this file system (Rook names its MDS "<fs>-a", "<fs>-b" and sets mds_join_fs). */
export function standbysFor(fs: CephFs, map: FsMap): MdsDaemon[] {
  return map.standbys.filter(s => s.joinFscid === fs.id || (s.joinFscid === -1 && s.name.startsWith(`${fs.name}-`)));
}

export type Tone = 'ok' | 'warn' | 'err' | 'move' | 'idle';

/** Tone and word for an MDS state. */
export function mdsTone(state: string): Tone {
  if (state === 'active') return 'ok';
  if (state === 'standby' || state === 'standby-replay') return 'idle';
  if (state === 'failed' || state === 'damaged') return 'err';
  if (state === 'stopping') return 'warn';
  return 'move';
}

export function mdsWord(state: string): string {
  if (!state) return 'Unknown';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/** Is a file system serving clients? */
export function fsState(fs: CephFs): { tone: Tone; word: string; detail: string } {
  if (!fs.enabled || fs.refuseClientSession) return { tone: 'warn', word: 'Refusing clients', detail: 'The file system does not accept new client sessions.' };
  if (fs.damaged.length) return { tone: 'err', word: 'Damaged', detail: `Rank ${fs.damaged.join(', ')} is damaged: metadata needs repair.` };
  if (!fs.joinable && fs.ranks.every(r => r.state !== 'active')) return { tone: 'idle', word: 'Down', detail: 'The file system is marked down (not joinable).' };
  if (!fs.ranks.length) return { tone: 'err', word: 'No ranks', detail: 'No MDS rank is in.' };
  const bad = fs.ranks.filter(r => r.state === 'failed');
  if (bad.length) return { tone: 'err', word: 'Offline', detail: `Rank ${bad.map(r => r.rank).join(', ')} has no MDS: clients hang.` };
  const moving = fs.ranks.filter(r => r.state !== 'active');
  if (moving.length) return { tone: 'move', word: 'Recovering', detail: `Rank ${moving.map(r => `${r.rank} ${r.state}`).join(', ')}.` };
  return { tone: 'ok', word: 'Active', detail: `${fs.ranks.length} active rank${fs.ranks.length === 1 ? '' : 's'}.` };
}

/* ------------------------------------------------------ subvolumes */

/** "fs subvolumegroup ls" / "fs subvolume ls": [{name}]. */
export function parseNameList(raw: any): string[] {
  return arr(raw)
    .map((x: any) => str(typeof x === 'string' ? x : x?.name))
    .filter(Boolean);
}

export interface SubvolumeGroup {
  name: string;
  usedBytes: number | null;
  /** null: no quota. */
  quotaBytes: number | null;
  dataPool: string;
  mode: string;
  created: number | null;
}

export interface Subvolume {
  name: string;
  group: string;
  usedBytes: number | null;
  quotaBytes: number | null;
  path: string;
  state: string;
  type: string;
  dataPool: string;
  poolNamespace: string;
  created: number | null;
  features: string[];
  error?: string;
}

const quota = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

/** "fs subvolumegroup info". */
export function parseGroupInfo(raw: any, name: string): SubvolumeGroup {
  const d = obj(raw);
  return {
    name,
    usedBytes: typeof d.bytes_used === 'number' ? d.bytes_used : null,
    quotaBytes: quota(d.bytes_quota),
    dataPool: str(d.data_pool),
    mode: d.mode !== undefined ? Number(d.mode).toString(8) : '',
    created: cephTimeMs(d.created_at),
  };
}

/** "fs subvolume info". */
export function parseSubvolumeInfo(raw: any, name: string, group: string): Subvolume {
  const d = obj(raw);
  return {
    name,
    group,
    usedBytes: typeof d.bytes_used === 'number' ? d.bytes_used : null,
    quotaBytes: quota(d.bytes_quota),
    path: str(d.path),
    state: str(d.state),
    type: str(d.type),
    dataPool: str(d.data_pool),
    poolNamespace: str(d.pool_namespace),
    created: cephTimeMs(d.created_at),
    features: arr(d.features).map(str),
  };
}

/** The group Ceph puts subvolumes made without one in. */
export const NO_GROUP = '_nogroup';

/* --------------------------------------------------- Kubernetes side */

export interface FsVolume {
  pv: Obj;
  driver: string;
  fsName: string;
  subvolume: string;
  group: string;
  clusterID: string;
  /** namespace/name of the claim, when bound. */
  claim: string;
  /** A static PV (rootPath, no subvolume). */
  static: boolean;
}

export const isCephfsDriver = (d: string) => /(^|\.)cephfs\.csi\.ceph\.com$/.test(d);

/** The group from a CSI subvolumePath ("/volumes/<group>/<subvolume>/<uuid>"). */
export function groupFromPath(p: string): string {
  const m = p.match(/^\/volumes\/([^/]+)\/[^/]+/);
  return m ? m[1] : '';
}

/** CephFS volumes of Kubernetes (Ceph-CSI PVs), optionally of one file system. */
export function cephfsVolumes(pvs: Obj[], fsName?: string): FsVolume[] {
  const out: FsVolume[] = [];
  for (const pv of pvs) {
    const csi = pv.spec?.csi;
    if (!csi || !isCephfsDriver(str(csi.driver))) continue;
    const a = obj(csi.volumeAttributes);
    const fs = str(a.fsName);
    if (fsName && fs !== fsName) continue;
    const ref = pv.spec?.claimRef;
    out.push({
      pv,
      driver: str(csi.driver),
      fsName: fs,
      subvolume: str(a.subvolumeName),
      group: groupFromPath(str(a.subvolumePath)) || str(a.subvolumeGroup),
      clusterID: str(a.clusterID),
      claim: ref?.name ? `${ref.namespace}/${ref.name}` : '',
      static: a.staticVolume === 'true' || (!!a.rootPath && !a.subvolumeName),
    });
  }
  return out;
}

/** Is there a CephFS CSI driver (ceph-csi-operator Driver, or a StorageClass using one)? */
export function cephfsCsi(drivers: Obj[], storageClasses: Obj[]): { present: boolean; driver?: string; storageClasses: string[]; others: string[] } {
  const d = drivers.find(x => isCephfsDriver(x.metadata.name));
  const scs = storageClasses.filter(sc => isCephfsDriver(str(sc.provisioner))).map(sc => sc.metadata.name);
  return {
    present: !!d,
    driver: d?.metadata.name,
    storageClasses: scs,
    others: drivers.map(x => x.metadata.name).filter(n => !isCephfsDriver(n)),
  };
}

/** StorageClasses that provision volumes from this file system. */
export function fsStorageClasses(storageClasses: Obj[], fsName: string): Obj[] {
  return storageClasses.filter(sc => isCephfsDriver(str(sc.provisioner)) && str(sc.parameters?.fsName) === fsName);
}

/* ----------------------------------------------------- Rook resources */

export interface DataPoolForm {
  name: string;
  /** Replicas, or 0 for erasure coding. */
  size: number;
  ec?: { k: number; m: number };
}

export interface FsForm {
  name: string;
  namespace: string;
  metadataSize: number;
  dataPools: DataPoolForm[];
  failureDomain: string;
  deviceClass: string;
  activeCount: number;
  activeStandby: boolean;
  cpuRequest: string;
  memRequest: string;
  memLimit: string;
  /** Keep the Ceph file system (and its pools) when the resource is deleted. */
  preserve: boolean;
}

export const DEFAULT_FS_FORM: FsForm = {
  name: '',
  namespace: 'rook-ceph',
  metadataSize: 3,
  dataPools: [{ name: 'data0', size: 3 }],
  failureDomain: 'host',
  deviceClass: '',
  activeCount: 1,
  activeStandby: true,
  cpuRequest: '500m',
  memRequest: '1Gi',
  memLimit: '4Gi',
  preserve: true,
};

const QUANTITY = /^\d+(\.\d+)?(m|k|Ki|M|Mi|G|Gi|T|Ti)?$/;

export function quantityProblem(q: string, what: string): string | null {
  if (!q.trim()) return null;
  return QUANTITY.test(q.trim()) ? null : `${what}: a Kubernetes quantity like 256Mi, 1Gi or 100m.`;
}

/** Bytes of a Kubernetes quantity (for comparing request and limit), or null. */
export function quantityBytes(q: string): number | null {
  const m = q.trim().match(/^(\d+(?:\.\d+)?)(k|Ki|M|Mi|G|Gi|T|Ti)?$/);
  if (!m) return null;
  const f: Record<string, number> = { '': 1, k: 1e3, Ki: 1024, M: 1e6, Mi: 1024 ** 2, G: 1e9, Gi: 1024 ** 3, T: 1e12, Ti: 1024 ** 4 };
  return Number(m[1]) * f[m[2] ?? ''];
}

const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function k8sNameProblem(name: string, max = 63): string | null {
  if (!name) return 'Give it a name.';
  if (name.length > max) return `At most ${max} characters.`;
  if (!NAME_RE.test(name)) return 'Lowercase letters, digits and dashes; start and end with a letter or digit.';
  return null;
}

/** Problems with the form, by field. `taken` are file system names in use (CRs and Ceph). */
export function fsFormProblems(f: FsForm, taken: Set<string>, osdHosts = 3): Record<string, string> {
  const p: Record<string, string> = {};
  const n = k8sNameProblem(f.name, 40);
  if (n) p.name = n;
  else if (taken.has(f.name)) p.name = `${f.name} exists already.`;
  if (!(f.metadataSize >= 1 && f.metadataSize <= 7)) p.metadataSize = 'Between 1 and 7 replicas.';
  else if (f.failureDomain === 'host' && f.metadataSize > osdHosts) p.metadataSize = `Only ${osdHosts} hosts have OSDs: at most ${osdHosts} replicas across hosts.`;
  if (!f.dataPools.length) p.dataPools = 'A file system needs a data pool.';
  const names = new Set<string>();
  f.dataPools.forEach((d, i) => {
    const dn = k8sNameProblem(d.name, 30);
    if (dn) p[`pool${i}`] = dn;
    else if (names.has(d.name)) p[`pool${i}`] = 'Two data pools with the same name.';
    names.add(d.name);
    if (d.ec) {
      if (i === 0) p[`pool${i}`] = 'The first data pool must be replicated (CephFS keeps backtraces there).';
      else if (!(d.ec.k >= 2 && d.ec.m >= 1)) p[`pool${i}`] = 'Erasure coding needs at least 2 data and 1 coding chunks.';
      else if (f.failureDomain === 'host' && d.ec.k + d.ec.m > osdHosts) p[`pool${i}`] = `${d.ec.k}+${d.ec.m} chunks need ${d.ec.k + d.ec.m} hosts; ${osdHosts} have OSDs.`;
    } else if (!(d.size >= 1 && d.size <= 7)) p[`pool${i}`] = 'Between 1 and 7 replicas.';
    else if (f.failureDomain === 'host' && d.size > osdHosts) p[`pool${i}`] = `Only ${osdHosts} hosts have OSDs.`;
  });
  if (!(f.activeCount >= 1 && f.activeCount <= 50)) p.activeCount = 'Between 1 and 50 active MDS.';
  for (const [k, v, w] of [
    ['cpuRequest', f.cpuRequest, 'CPU request'],
    ['memRequest', f.memRequest, 'Memory request'],
    ['memLimit', f.memLimit, 'Memory limit'],
  ] as const) {
    const q = quantityProblem(v, w);
    if (q) p[k] = q;
  }
  const rq = quantityBytes(f.memRequest);
  const lm = quantityBytes(f.memLimit);
  if (!p.memLimit && rq !== null && lm !== null && lm < rq) p.memLimit = 'The limit is below the request.';
  return p;
}

function poolSpec(d: { size: number; ec?: { k: number; m: number } }, failureDomain: string, deviceClass: string): any {
  const s: any = { failureDomain };
  if (deviceClass) s.deviceClass = deviceClass;
  if (d.ec) s.erasureCoded = { dataChunks: d.ec.k, codingChunks: d.ec.m };
  else s.replicated = { size: d.size, ...(d.size < 2 ? { requireSafeReplicaSize: false } : {}) };
  return s;
}

function resources(cpuRequest: string, memRequest: string, memLimit: string): any {
  const r: any = {};
  const requests: any = {};
  if (cpuRequest.trim()) requests.cpu = cpuRequest.trim();
  if (memRequest.trim()) requests.memory = memRequest.trim();
  if (Object.keys(requests).length) r.requests = requests;
  if (memLimit.trim()) r.limits = { memory: memLimit.trim() };
  return r;
}

export function filesystemCR(f: FsForm): Obj {
  const res = resources(f.cpuRequest, f.memRequest, f.memLimit);
  return {
    apiVersion: 'ceph.rook.io/v1',
    kind: 'CephFilesystem',
    metadata: { name: f.name, namespace: f.namespace },
    spec: {
      metadataPool: poolSpec({ size: f.metadataSize }, f.failureDomain, f.deviceClass),
      dataPools: f.dataPools.map(d => ({ name: d.name, ...poolSpec(d, f.failureDomain, f.deviceClass) })),
      preserveFilesystemOnDelete: f.preserve,
      metadataServer: {
        activeCount: f.activeCount,
        activeStandby: f.activeStandby,
        ...(Object.keys(res).length ? { resources: res } : {}),
      },
    },
  };
}

/** The Ceph pools Rook makes for a CephFilesystem ("<fs>-metadata", "<fs>-<data pool>"). */
export function rookFsPools(cr: Obj): { metadata: string; data: string[] } {
  const name = cr.metadata.name;
  const keep = !!cr.spec?.preservePoolNames;
  const md = str(cr.spec?.metadataPool?.name);
  return {
    metadata: keep && md ? md : `${name}-metadata`,
    data: arr(cr.spec?.dataPools).map((d: any, i: number) => {
      const n = str(d?.name);
      if (keep && n) return n;
      return n ? `${name}-${n}` : `${name}-data${i}`;
    }),
  };
}

/** How many MDS pods Rook runs for a CephFilesystem: one per rank, two with standby-replay (Rook 1.21). */
export function mdsPodCount(cr: Obj): number {
  return Math.max(1, num(cr.spec?.metadataServer?.activeCount, 1)) * (cr.spec?.metadataServer?.activeStandby ? 2 : 1);
}

export interface SvgForm {
  name: string;
  namespace: string;
  filesystem: string;
  /** Ceph's group name when it differs from the resource name. */
  groupName: string;
  /** "10Gi"; empty for none. */
  quota: string;
  pinning: 'distributed' | 'none';
  dataPoolName: string;
}

export const DEFAULT_SVG_FORM: SvgForm = { name: '', namespace: 'rook-ceph', filesystem: '', groupName: '', quota: '', pinning: 'distributed', dataPoolName: '' };

export function svgFormProblems(f: SvgForm, takenCrs: Set<string>, groups: Set<string>): Record<string, string> {
  const p: Record<string, string> = {};
  const n = k8sNameProblem(f.name);
  if (n) p.name = n;
  else if (takenCrs.has(f.name)) p.name = `A CephFilesystemSubVolumeGroup ${f.name} exists already.`;
  if (!f.filesystem) p.filesystem = 'Pick a file system.';
  const g = f.groupName.trim() || f.name;
  if (!p.name && groups.has(g)) p.groupName = `Ceph has a group ${g} in ${f.filesystem} already.`;
  if (g === NO_GROUP || g === 'csi') p.groupName = `${g} is reserved.`;
  const q = quantityProblem(f.quota, 'Quota');
  if (q) p.quota = q;
  return p;
}

export function subvolumeGroupCR(f: SvgForm): Obj {
  const spec: any = { filesystemName: f.filesystem };
  if (f.groupName.trim() && f.groupName.trim() !== f.name) spec.name = f.groupName.trim();
  if (f.quota.trim()) spec.quota = f.quota.trim();
  if (f.dataPoolName.trim()) spec.dataPoolName = f.dataPoolName.trim();
  spec.pinning = f.pinning === 'distributed' ? { distributed: 1 } : {};
  if (f.pinning === 'none') delete spec.pinning;
  return {
    apiVersion: 'ceph.rook.io/v1',
    kind: 'CephFilesystemSubVolumeGroup',
    metadata: { name: f.name, namespace: f.namespace },
    spec,
  };
}

/** The Ceph group name of a CephFilesystemSubVolumeGroup (spec.name, else the CR name). */
export function svgGroupName(cr: Obj): string {
  return str(cr.spec?.name) || cr.metadata.name;
}

/** Pinning of a subvolume group resource, in words. */
export function pinningWord(cr: Obj): string {
  const p = obj(cr.spec?.pinning);
  if (p.distributed !== undefined && p.distributed !== null) return p.distributed ? 'Distributed' : 'Not distributed';
  if (p.export !== undefined && p.export !== null) return `Rank ${p.export}`;
  if (p.random !== undefined && p.random !== null) return `Random ${p.random}`;
  return 'None';
}

/**
 * Why a file system resource may not be deleted now: Kubernetes volumes on
 * it (data would vanish under running pods) and subvolume group resources
 * (Rook waits for them).
 */
export function fsDeleteBlockers(fsName: string, pvs: Obj[], svgs: Obj[], nfs: Obj[] = []): string[] {
  const out: string[] = [];
  const vols = cephfsVolumes(pvs, fsName);
  if (vols.length)
    out.push(
      `${vols.length} Kubernetes volume${vols.length === 1 ? ' uses' : 's use'} it: ${vols
        .slice(0, 5)
        .map(v => (v.claim ? `${v.pv.metadata.name} (${v.claim})` : v.pv.metadata.name))
        .join(', ')}${vols.length > 5 ? '…' : ''}.`
    );
  const groups = svgs.filter(s => str(s.spec?.filesystemName) === fsName);
  if (groups.length) out.push(`Subvolume group resources depend on it: ${groups.map(g => g.metadata.name).join(', ')}. Delete them first.`);
  const exports = nfs.filter(n => JSON.stringify(n.spec ?? {}).includes(`"${fsName}"`));
  if (exports.length) out.push(`CephNFS ${exports.map(n => n.metadata.name).join(', ')} may export it.`);
  return out;
}

/** Why a subvolume group may not be deleted: subvolumes in it (Kubernetes volumes or others). */
export function svgDeleteBlockers(cr: Obj, pvs: Obj[], subvolumes: string[] | null): string[] {
  const out: string[] = [];
  const fs = str(cr.spec?.filesystemName);
  const g = svgGroupName(cr);
  const clusterID = str(cr.status?.info?.clusterID);
  const vols = cephfsVolumes(pvs, fs).filter(v => v.group === g || (clusterID && v.clusterID === clusterID));
  if (vols.length)
    out.push(
      `${vols.length} Kubernetes volume${vols.length === 1 ? ' lives' : 's live'} in it: ${vols
        .slice(0, 5)
        .map(v => (v.claim ? `${v.pv.metadata.name} (${v.claim})` : v.pv.metadata.name))
        .join(', ')}${vols.length > 5 ? '…' : ''}.`
    );
  else if (subvolumes && subvolumes.length) out.push(`Ceph has ${subvolumes.length} subvolume${subvolumes.length === 1 ? '' : 's'} in it (${subvolumes.slice(0, 3).join(', ')}).`);
  return out;
}

/** Conditions of a Rook resource, newest first. */
export function conditions(cr: Obj): { type: string; status: string; reason: string; message: string; at: string }[] {
  return arr(cr.status?.conditions)
    .map((c: any) => ({ type: str(c.type), status: str(c.status), reason: str(c.reason), message: str(c.message), at: str(c.lastTransitionTime ?? c.lastHeartbeatTime) }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Tone of a Rook phase. */
export function phaseTone(phase: string | undefined): Tone {
  const p = (phase ?? '').toLowerCase();
  if (['ready', 'connected', 'bound'].includes(p)) return 'ok';
  if (['progressing', 'creating', 'connecting', 'pending', 'updating'].includes(p)) return 'move';
  if (['failure', 'failed', 'error', 'lost'].includes(p)) return 'err';
  if (p === 'deleting' || p === 'released') return 'warn';
  return 'idle';
}
