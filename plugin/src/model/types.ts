/*
 * The Ceph and Kubernetes shapes Cairn works with, after parsing
 * (src/model/parse.ts). Loose where Ceph is loose: optional fields,
 * unknown ones ignored, so newer Ceph releases do not break the views.
 */

export interface Meta {
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: { kind: string; name: string; uid?: string; apiVersion?: string; controller?: boolean }[];
  generation?: number;
  finalizers?: string[];
  /** Who wrote which field (src/model/ownership.ts). */
  managedFields?: ManagedFieldsEntry[];
}

/** One writer's fields, as the API server records them (FieldsV1 tree). */
export interface ManagedFieldsEntry {
  manager?: string;
  operation?: string;
  apiVersion?: string;
  fieldsType?: string;
  fieldsV1?: Record<string, unknown>;
  subresource?: string;
  time?: string;
}

/** A Kubernetes object as plain JSON. */
export interface Obj {
  apiVersion?: string;
  kind?: string;
  metadata: Meta;
  spec?: any;
  status?: any;
  [k: string]: any;
}

export type Severity = 'HEALTH_OK' | 'HEALTH_WARN' | 'HEALTH_ERR';

export interface HealthCheck {
  /** Ceph's code, e.g. OSD_DOWN. */
  code: string;
  severity: Severity;
  summary: string;
  /** Affected items, from summary.count. */
  count: number;
  /** Detail lines (health detail). */
  details: string[];
  muted: boolean;
  /** When Ceph first and last saw it active (healthcheck history, ms). */
  firstSeen?: number | null;
  lastSeen?: number | null;
}

export interface HealthMute {
  code: string;
  /** Expiry time (ms) when the mute has a TTL. */
  until?: number | null;
  sticky: boolean;
  summary?: string;
  count?: number;
}

export interface Health {
  status: Severity;
  checks: HealthCheck[];
  mutes: HealthMute[];
}

/** A check Ceph saw in the past (healthcheck history ls). */
export interface HealthHistoryEntry {
  code: string;
  severity: Severity;
  firstSeen: number | null;
  lastSeen: number | null;
  count: number;
  active: boolean;
}

export interface PgStateCount {
  state: string;
  count: number;
}

export interface ClientIo {
  readBps: number;
  writeBps: number;
  readOps: number;
  writeOps: number;
}

export interface Recovery {
  bytesPerSec: number;
  objectsPerSec: number;
  keysPerSec: number;
  degradedObjects: number;
  degradedTotal: number;
  degradedRatio: number;
  misplacedObjects: number;
  misplacedTotal: number;
  misplacedRatio: number;
  unfoundObjects: number;
}

export interface ProgressEvent {
  id: string;
  message: string;
  /** 0..1 */
  progress: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  failed?: boolean;
}

export interface ClusterStatus {
  fsid: string;
  health: Health;
  quorum: string[];
  quorumAgeSec: number;
  monCount: number;
  osd: { total: number; up: number; in: number; remappedPgs: number; upSince?: number | null; inSince?: number | null };
  pg: { total: number; byState: PgStateCount[] };
  pools: number;
  objects: number;
  dataBytes: number;
  usedBytes: number;
  availBytes: number;
  totalBytes: number;
  io: ClientIo;
  recovery: Recovery;
  progress: ProgressEvent[];
  mgr: { available: boolean; standbys: number; modules: string[]; services: Record<string, string> };
  fs: { up: number; standby: number; epoch: number };
}

export interface OsdMeta {
  id: number;
  /** The host (Kubernetes node) the OSD runs on. */
  hostname: string;
  /** Kernel names of the backing devices, e.g. ["sdb"]. */
  devices: string[];
  /** Stable paths, e.g. { sdb: "/dev/disk/by-path/..." }. */
  devicePaths: Record<string, string>;
  /** Device ids (model_serial), e.g. { sdb: "QEMU_HARDDISK_X" }. */
  deviceIds: Record<string, string>;
  rotational: boolean | null;
  bdevType: string;
  bdevSize: number;
  objectstore: string;
  version: string;
  kernel: string;
  distro: string;
  podName: string;
  podNamespace: string;
  dedicatedDb: boolean;
  dedicatedWal: boolean;
  memTotalKb: number;
}

export interface Osd {
  id: number;
  name: string;
  /** CRUSH host bucket (Ceph's name, "kube-node-1-example-com"). */
  host: string;
  deviceClass: string;
  crushWeight: number;
  /** 0..1 override weight (1 = in fully, 0 = out). */
  reweight: number;
  primaryAffinity: number;
  up: boolean;
  in: boolean;
  /** "up", "down", "destroyed"… from the tree. */
  status: string;
  sizeBytes: number;
  usedBytes: number;
  availBytes: number;
  dataBytes: number;
  omapBytes: number;
  metaBytes: number;
  /** 0..100 */
  utilization: number;
  variance: number;
  pgs: number;
  commitMs?: number;
  applyMs?: number;
  /** Per-OSD flags (noout, noin, nodown, noup) set with "osd add-noout" & co. */
  flags: string[];
  meta?: OsdMeta;
}

/** A CRUSH bucket (root, datacenter, rack, host…) with its children ids. */
export interface CrushBucket {
  id: number;
  name: string;
  type: string;
  children: number[];
  sizeBytes: number;
  usedBytes: number;
  utilization: number;
}

export interface CrushHost extends CrushBucket {
  osds: number[];
  /** The Kubernetes node behind it (from OSD metadata), when known. */
  node?: string;
}

export interface OsdMapInfo {
  epoch: number;
  /** Cluster-wide flags: noout, norebalance, noscrub… (without the internal ones). */
  flags: string[];
  fullRatio: number;
  backfillFullRatio: number;
  nearFullRatio: number;
  requireOsdRelease: string;
  requireMinCompatClient: string;
  /** OSD id → its own flags. */
  osdFlags: Record<number, string[]>;
  /** CRUSH bucket (host, rack…) → flags set on it with "osd set-group" (noout…). */
  crushNodeFlags: Record<string, string[]>;
  /** Device class → flags set on it with "osd set-group". */
  deviceClassFlags: Record<string, string[]>;
  /** Pools as the OSD map knows them (raw, see PoolInfo). */
  pools: any[];
  ecProfiles: Record<string, Record<string, string>>;
  blocklistCount: number;
}

export interface PoolUsage {
  stored: number;
  storedRaw: number;
  used: number;
  maxAvail: number;
  percentUsed: number;
  objects: number;
  quotaBytes: number;
  quotaObjects: number;
  compressBytesUsed: number;
  compressUnderBytes: number;
  rdOps: number;
  rdBytes: number;
  wrOps: number;
  wrBytes: number;
}

export interface Pool {
  id: number;
  name: string;
  type: 'replicated' | 'erasure';
  size: number;
  minSize: number;
  crushRuleId: number;
  crushRule: string;
  pgNum: number;
  pgpNum: number;
  pgNumTarget: number;
  autoscaleMode: string;
  applications: string[];
  compressionMode: string;
  ecProfile: string;
  /** k and m of an erasure-coded pool. */
  ec?: { k: number; m: number };
  flags: string[];
  quotaBytes: number;
  quotaObjects: number;
  /** Raw bytes written per stored byte (size, or (k+m)/k). */
  rawFactor: number;
  createdAt?: number | null;
  usage?: PoolUsage;
  io?: ClientIo;
  recovering?: boolean;
}

export interface AutoscaleStatus {
  poolId: number;
  pool: string;
  pgNum: number;
  pgNumIdeal: number;
  pgNumFinal: number;
  mode: string;
  bulk: boolean;
  wouldAdjust: boolean;
  targetRatio: number;
  targetBytes: number;
  capacityRatio: number;
}

export interface CrushRule {
  id: number;
  name: string;
  type: 'replicated' | 'erasure' | string;
  /** Root bucket it takes from. */
  root: string;
  /** Failure domain (chooseleaf type). */
  failureDomain: string;
  deviceClass?: string;
}

export interface MonInfo {
  rank: number;
  name: string;
  addr: string;
  inQuorum: boolean;
  leader: boolean;
}

export interface Quorum {
  leader: string;
  quorum: string[];
  ageSec: number;
  mons: MonInfo[];
  allowedCiphers: string[];
  preferredCipher: string;
  serviceCipher: string;
  minMonRelease: string;
}

export interface CrashEntry {
  id: string;
  entity: string;
  time: number | null;
  archived: boolean;
  version?: string;
  process?: string;
}

export interface MgrInfo {
  active: string;
  standbys: string[];
  available: boolean;
  modules: string[];
  alwaysOn: string[];
  services: Record<string, string>;
  activeSince: number | null;
}

/** "ceph versions": daemon type → version → count. */
export type Versions = Record<string, Record<string, number>>;

export interface PgBrief {
  pgid: string;
  pool: number;
  state: string;
  up: number[];
  acting: number[];
  primary: number;
}

export interface LogEntry {
  time: number | null;
  who: string;
  channel: string;
  priority: string;
  message: string;
  seq: number;
}

export interface ConfigEntry {
  section: string;
  name: string;
  value: string;
  level: string;
  runtime: boolean;
  mask: string;
}
