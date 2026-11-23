/*
 * Object storage (RGW): CephObjectStore resources and their gateways,
 * users (CephObjectStoreUser + radosgw-admin), buckets (radosgw-admin
 * bucket stats), ObjectBucketClaims and the StorageClasses that provision
 * them. The bridge blanks secret keys; this module drops access keys too,
 * so no credential is ever kept outside the Secret Rook writes.
 */

import { Obj, Pool } from './types';

const obj = (v: unknown): any => (v && typeof v === 'object' ? v : {});
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return isFinite(n) ? n : d;
};

function timeMs(v: unknown): number | null {
  let s = str(v).trim();
  if (!s) return null;
  s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2').replace(/\.(\d{3})\d+/, '.$1');
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

/* ------------------------------------------------------------- stores */

export interface StoreInfo {
  cr: Obj;
  name: string;
  namespace: string;
  phase: string;
  /** http(s) endpoints from the status. */
  endpoints: string[];
  port: number | null;
  securePort: number | null;
  instances: number;
  pods: Obj[];
  readyPods: number;
  /** Multisite zone (spec.zone.name), when the store joins one. */
  zone: string;
  /** Pools shared with other stores (spec.sharedPools). */
  shared: boolean;
}

const podReady = (p: Obj) =>
  p.status?.phase === 'Running' && !p.metadata.deletionTimestamp && arr(p.status?.containerStatuses).every((c: any) => c.ready);

export function rgwPods(storeName: string, pods: Obj[]): Obj[] {
  return pods.filter(p => p.metadata.labels?.app === 'rook-ceph-rgw' && p.metadata.labels?.rook_object_store === storeName);
}

export function storeInfo(cr: Obj, pods: Obj[]): StoreInfo {
  const st = obj(cr.status);
  const ep = obj(st.endpoints);
  const endpoints = [...arr<string>(ep.secure), ...arr<string>(ep.insecure)].map(str).filter(Boolean);
  if (!endpoints.length) {
    const info = obj(st.info);
    for (const k of ['secureEndpoint', 'endpoint']) if (info[k]) endpoints.push(str(info[k]));
  }
  const mine = rgwPods(cr.metadata.name, pods);
  const gw = obj(cr.spec?.gateway);
  return {
    cr,
    name: cr.metadata.name,
    namespace: cr.metadata.namespace ?? '',
    phase: str(st.phase),
    endpoints,
    port: gw.port ? num(gw.port) : null,
    securePort: gw.securePort ? num(gw.securePort) : null,
    instances: num(gw.instances, 1),
    pods: mine,
    readyPods: mine.filter(podReady).length,
    zone: str(cr.spec?.zone?.name),
    shared: !!(cr.spec?.sharedPools?.metadataPoolName || cr.spec?.sharedPools?.dataPoolName),
  };
}

/**
 * radosgw-admin arguments that select the store's realm, zone group and
 * zone. Rook names all three after the store unless it joins a multisite
 * zone (then only --rgw-zone is certain).
 */
export function rgwArgs(store: Obj): string[] {
  const zone = str(store.spec?.zone?.name);
  if (zone) return ['--rgw-zone', zone];
  const n = store.metadata.name;
  return ['--rgw-realm', n, '--rgw-zonegroup', n, '--rgw-zone', n];
}

/** The Ceph pools of a store: "<store>.rgw.*" plus the shared ".rgw.root". */
export function storePools(storeName: string, pools: Pool[]): Pool[] {
  const prefix = `${storeName}.rgw.`;
  return pools.filter(p => p.name.startsWith(prefix) || p.name === '.rgw.root');
}

/* -------------------------------------------------------------- users */

export interface Quota {
  enabled: boolean;
  /** null: unlimited. */
  maxSizeBytes: number | null;
  maxObjects: number | null;
}

export interface RgwUser {
  uid: string;
  displayName: string;
  email: string;
  suspended: boolean;
  maxBuckets: number;
  caps: { type: string; perm: string }[];
  /** How many S3 / Swift keys the user has (never the keys). */
  keyCount: number;
  swiftKeyCount: number;
  subusers: number;
  userQuota: Quota;
  bucketQuota: Quota;
  opMask: string;
  defaultPlacement: string;
  defaultStorageClass: string;
  type: string;
}

export function parseQuota(raw: any): Quota {
  const q = obj(raw);
  const size = num(q.max_size, -1);
  const objs = num(q.max_objects, -1);
  return { enabled: !!q.enabled, maxSizeBytes: size > 0 ? size : null, maxObjects: objs >= 0 ? objs : null };
}

/** "radosgw-admin user list": uids. */
export function parseUidList(raw: any): string[] {
  return arr(raw).map(str).filter(Boolean);
}

/** "radosgw-admin user info --uid X" without any key material. */
export function parseRgwUser(raw: any): RgwUser {
  const u = obj(raw);
  return {
    uid: str(u.user_id),
    displayName: str(u.display_name),
    email: str(u.email),
    suspended: !!num(u.suspended),
    maxBuckets: num(u.max_buckets, 1000),
    caps: arr(u.caps).map((c: any) => ({ type: str(c.type), perm: str(c.perm) })),
    keyCount: arr(u.keys).length,
    swiftKeyCount: arr(u.swift_keys).length,
    subusers: arr(u.subusers).length,
    userQuota: parseQuota(u.user_quota),
    bucketQuota: parseQuota(u.bucket_quota),
    opMask: str(u.op_mask),
    defaultPlacement: str(u.default_placement),
    defaultStorageClass: str(u.default_storage_class),
    type: str(u.type),
  };
}

/** The radosgw uid of a CephObjectStoreUser: the resource name. */
export function userUid(cr: Obj): string {
  return cr.metadata.name;
}

/** The users of one store: resources and radosgw users, merged by uid. */
export interface UserRow {
  uid: string;
  cr?: Obj;
  rgw?: RgwUser;
  /** Buckets this user owns, and their bytes and objects. */
  buckets: number;
  bytes: number;
  objects: number;
  /** Made by the bucket provisioner for an ObjectBucketClaim. */
  forClaim: boolean;
}

export function storeUsersOf(store: Obj, users: Obj[]): Obj[] {
  return users.filter(
    u => str(u.spec?.store) === store.metadata.name && (str(u.spec?.clusterNamespace) || u.metadata.namespace) === store.metadata.namespace
  );
}

export function userRows(crs: Obj[], uids: string[] | null, infos: Map<string, RgwUser>, buckets: Bucket[]): UserRow[] {
  const all = new Set<string>([...crs.map(userUid), ...(uids ?? [])]);
  return [...all].sort().map(uid => {
    const own = buckets.filter(b => b.owner === uid);
    return {
      uid,
      cr: crs.find(c => userUid(c) === uid),
      rgw: infos.get(uid),
      buckets: own.length,
      bytes: own.reduce((n, b) => n + b.sizeBytes, 0),
      objects: own.reduce((n, b) => n + b.objects, 0),
      forClaim: uid.startsWith('obc-'),
    };
  });
}

/* ------------------------------------------------------------ buckets */

export interface Bucket {
  name: string;
  tenant: string;
  owner: string;
  id: string;
  zonegroup: string;
  placement: string;
  shards: number;
  objects: number;
  /** Logical bytes (size) and on-disk bytes (size_actual, rounded to 4 KiB). */
  sizeBytes: number;
  sizeActualBytes: number;
  created: number | null;
  modified: number | null;
  quota: Quota;
  versioning?: string;
}

/** "radosgw-admin bucket stats": one entry per bucket. */
export function parseBucketStats(raw: any): Bucket[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && raw.bucket ? [raw] : [];
  return list.map((b: any) => {
    let objects = 0;
    let size = 0;
    let actual = 0;
    for (const u of Object.values(obj(b.usage)) as any[]) {
      objects += num(u?.num_objects);
      size += num(u?.size);
      actual += num(u?.size_actual);
    }
    return {
      name: str(b.bucket),
      tenant: str(b.tenant),
      owner: str(b.owner),
      id: str(b.id),
      zonegroup: str(b.zonegroup),
      placement: str(b.placement_rule ?? b.explicit_placement?.data_pool),
      shards: num(b.num_shards),
      objects,
      sizeBytes: size,
      sizeActualBytes: actual,
      created: timeMs(b.creation_time),
      modified: timeMs(b.mtime),
      quota: parseQuota(b.bucket_quota),
      versioning: b.versioning ? str(b.versioning) : undefined,
    };
  });
}

/* -------------------------------------------------- claims and classes */

export const bucketProvisioner = (rookNs: string) => `${rookNs}.ceph.rook.io/bucket`;

export function isBucketClass(sc: Obj): boolean {
  return /\.ceph\.rook\.io\/bucket$/.test(str(sc.provisioner));
}

/** The store a bucket StorageClass provisions from. */
export function classStore(sc: Obj): { name: string; namespace: string } | null {
  const p = obj(sc.parameters);
  if (!p.objectStoreName) return null;
  return { name: str(p.objectStoreName), namespace: str(p.objectStoreNamespace) };
}

export function storeClasses(store: Obj, storageClasses: Obj[]): Obj[] {
  return storageClasses.filter(sc => {
    if (!isBucketClass(sc)) return false;
    const s = classStore(sc);
    return !!s && s.name === store.metadata.name && (s.namespace || store.metadata.namespace) === store.metadata.namespace;
  });
}

export interface Claim {
  obc: Obj;
  name: string;
  namespace: string;
  bucketName: string;
  phase: string;
  storageClass: string;
  /** The Secret and ConfigMap the provisioner writes (named after the claim). */
  secretName: string;
  configMapName: string;
  objectBucket: string;
  store: { name: string; namespace: string } | null;
}

export function claimInfo(obc: Obj, storageClasses: Obj[]): Claim {
  const sc = storageClasses.find(s => s.metadata.name === obc.spec?.storageClassName);
  return {
    obc,
    name: obc.metadata.name,
    namespace: obc.metadata.namespace ?? '',
    bucketName: str(obc.spec?.bucketName),
    phase: str(obc.status?.phase),
    storageClass: str(obc.spec?.storageClassName),
    secretName: obc.metadata.name,
    configMapName: obc.metadata.name,
    objectBucket: str(obc.spec?.objectBucketName),
    store: sc ? classStore(sc) : null,
  };
}

export function storeClaims(store: Obj, obcs: Obj[], storageClasses: Obj[]): Claim[] {
  const classes = new Set(storeClasses(store, storageClasses).map(s => s.metadata.name));
  return obcs.filter(o => classes.has(str(o.spec?.storageClassName))).map(o => claimInfo(o, storageClasses));
}

/** The claim behind a bucket, when one made it. */
export function claimForBucket(bucket: string, claims: Claim[]): Claim | undefined {
  return claims.find(c => c.bucketName === bucket);
}

/* ----------------------------------------------------------- builders */

const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function nameProblem(name: string, max = 63): string | null {
  if (!name) return 'Give it a name.';
  if (name.length > max) return `At most ${max} characters.`;
  if (!NAME_RE.test(name)) return 'Lowercase letters, digits and dashes; start and end with a letter or digit.';
  return null;
}

/** S3 bucket names: 3 to 63 lowercase letters, digits, dots and dashes. */
export function bucketNameProblem(name: string): string | null {
  if (!name) return null;
  if (name.length < 3 || name.length > 63) return '3 to 63 characters.';
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return 'Lowercase letters, digits, dots and dashes; start and end with a letter or digit.';
  if (/\.\./.test(name) || /^\d+\.\d+\.\d+\.\d+$/.test(name)) return 'No ".." and not an IP address.';
  return null;
}

export interface StoreForm {
  name: string;
  namespace: string;
  metadataSize: number;
  dataSize: number;
  /** Erasure-coded data pool (k data + m coding chunks) instead of replicas. */
  dataEc: { k: number; m: number } | null;
  failureDomain: string;
  port: number;
  instances: number;
  cpuRequest: string;
  memRequest: string;
  memLimit: string;
  preservePools: boolean;
}

export const DEFAULT_STORE_FORM: StoreForm = {
  name: '',
  namespace: 'rook-ceph',
  metadataSize: 3,
  dataSize: 3,
  dataEc: null,
  failureDomain: 'host',
  port: 80,
  instances: 1,
  cpuRequest: '500m',
  memRequest: '1Gi',
  memLimit: '2Gi',
  preservePools: true,
};

const QUANTITY = /^\d+(\.\d+)?(m|k|Ki|M|Mi|G|Gi|T|Ti)?$/;

export function storeFormProblems(f: StoreForm, taken: Set<string>, osdHosts = 3): Record<string, string> {
  const p: Record<string, string> = {};
  const n = nameProblem(f.name, 40);
  if (n) p.name = n;
  else if (taken.has(f.name)) p.name = `${f.name} exists already.`;
  if (!(f.metadataSize >= 1 && f.metadataSize <= 7)) p.metadataSize = 'Between 1 and 7 replicas.';
  else if (f.failureDomain === 'host' && f.metadataSize > osdHosts) p.metadataSize = `Only ${osdHosts} hosts have OSDs.`;
  if (f.dataEc) {
    if (!(f.dataEc.k >= 2 && f.dataEc.m >= 1)) p.data = 'At least 2 data and 1 coding chunks.';
    else if (f.failureDomain === 'host' && f.dataEc.k + f.dataEc.m > osdHosts) p.data = `${f.dataEc.k}+${f.dataEc.m} chunks need ${f.dataEc.k + f.dataEc.m} hosts; ${osdHosts} have OSDs.`;
  } else if (!(f.dataSize >= 1 && f.dataSize <= 7)) p.data = 'Between 1 and 7 replicas.';
  else if (f.failureDomain === 'host' && f.dataSize > osdHosts) p.data = `Only ${osdHosts} hosts have OSDs.`;
  if (!(f.port >= 1 && f.port <= 65535)) p.port = 'A port between 1 and 65535.';
  if (!(f.instances >= 1 && f.instances <= 20)) p.instances = 'Between 1 and 20 gateways.';
  for (const [k, v] of [
    ['cpuRequest', f.cpuRequest],
    ['memRequest', f.memRequest],
    ['memLimit', f.memLimit],
  ] as const)
    if (v.trim() && !QUANTITY.test(v.trim())) p[k] = 'A Kubernetes quantity like 256Mi, 1Gi or 100m.';
  return p;
}

function pool(size: number, failureDomain: string, ec?: { k: number; m: number } | null): any {
  if (ec) return { failureDomain, erasureCoded: { dataChunks: ec.k, codingChunks: ec.m } };
  return { failureDomain, replicated: { size, ...(size < 2 ? { requireSafeReplicaSize: false } : {}) } };
}

export function objectStoreCR(f: StoreForm): Obj {
  const requests: any = {};
  if (f.cpuRequest.trim()) requests.cpu = f.cpuRequest.trim();
  if (f.memRequest.trim()) requests.memory = f.memRequest.trim();
  const res: any = {};
  if (Object.keys(requests).length) res.requests = requests;
  if (f.memLimit.trim()) res.limits = { memory: f.memLimit.trim() };
  return {
    apiVersion: 'ceph.rook.io/v1',
    kind: 'CephObjectStore',
    metadata: { name: f.name, namespace: f.namespace },
    spec: {
      metadataPool: pool(f.metadataSize, f.failureDomain),
      dataPool: pool(f.dataSize, f.failureDomain, f.dataEc),
      preservePoolsOnDelete: f.preservePools,
      gateway: { port: f.port, instances: f.instances, ...(Object.keys(res).length ? { resources: res } : {}) },
    },
  };
}

export const USER_CAPS = ['users', 'buckets', 'metadata', 'usage', 'zone', 'info', 'roles', 'user-policy'] as const;
export type CapLevel = '' | 'read' | 'write' | 'read, write' | '*';

export interface UserForm {
  name: string;
  namespace: string;
  store: string;
  displayName: string;
  caps: Partial<Record<(typeof USER_CAPS)[number], CapLevel>>;
  maxBuckets: string;
  maxSize: string;
  maxObjects: string;
}

export function userFormProblems(f: UserForm, taken: Set<string>): Record<string, string> {
  const p: Record<string, string> = {};
  const n = nameProblem(f.name);
  if (n) p.name = n;
  else if (taken.has(f.name)) p.name = `The store has a user ${f.name} already.`;
  if (!f.store) p.store = 'Pick an object store.';
  if (f.maxBuckets.trim() && !/^\d+$/.test(f.maxBuckets.trim())) p.maxBuckets = 'A whole number.';
  if (f.maxObjects.trim() && !/^\d+$/.test(f.maxObjects.trim())) p.maxObjects = 'A whole number.';
  if (f.maxSize.trim() && !QUANTITY.test(f.maxSize.trim())) p.maxSize = 'A size like 10Gi or 500Mi.';
  return p;
}

export function objectUserCR(f: UserForm): Obj {
  const spec: any = { store: f.store, displayName: f.displayName.trim() || f.name };
  const caps: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.caps)) if (v) caps[k] = v;
  if (Object.keys(caps).length) spec.capabilities = caps;
  const quotas: any = {};
  if (f.maxBuckets.trim()) quotas.maxBuckets = Number(f.maxBuckets.trim());
  if (f.maxObjects.trim()) quotas.maxObjects = Number(f.maxObjects.trim());
  if (f.maxSize.trim()) quotas.maxSize = f.maxSize.trim();
  if (Object.keys(quotas).length) spec.quotas = quotas;
  return {
    apiVersion: 'ceph.rook.io/v1',
    kind: 'CephObjectStoreUser',
    metadata: { name: f.name, namespace: f.namespace },
    spec,
  };
}

export function bucketClassObj(o: { name: string; rookNs: string; store: string; storeNs: string; reclaim: 'Delete' | 'Retain'; region?: string }): Obj {
  const parameters: Record<string, string> = { objectStoreName: o.store, objectStoreNamespace: o.storeNs };
  if (o.region) parameters.region = o.region;
  return {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: { name: o.name },
    provisioner: bucketProvisioner(o.rookNs),
    reclaimPolicy: o.reclaim,
    parameters,
  };
}

export function bucketClaimObj(o: { name: string; namespace: string; storageClass: string; bucketName?: string; maxObjects?: string; maxSize?: string }): Obj {
  const spec: any = { storageClassName: o.storageClass };
  if (o.bucketName) spec.bucketName = o.bucketName;
  else spec.generateBucketName = o.name;
  const add: Record<string, string> = {};
  if (o.maxObjects) add.maxObjects = o.maxObjects;
  if (o.maxSize) add.maxSize = o.maxSize;
  if (Object.keys(add).length) spec.additionalConfig = add;
  return {
    apiVersion: 'objectbucket.io/v1alpha1',
    kind: 'ObjectBucketClaim',
    metadata: { name: o.name, namespace: o.namespace },
    spec,
  };
}

/** What still depends on a store (Rook refuses to remove it while buckets or users exist). */
export function storeDeleteBlockers(store: Obj, users: Obj[], obcs: Obj[], storageClasses: Obj[], buckets: Bucket[] | null): string[] {
  const out: string[] = [];
  const crs = storeUsersOf(store, users);
  if (crs.length) out.push(`User resources: ${crs.map(u => u.metadata.name).join(', ')}. Delete them first.`);
  const claims = storeClaims(store, obcs, storageClasses);
  if (claims.length) out.push(`Bucket claims: ${claims.map(c => `${c.namespace}/${c.name}`).join(', ')}. Delete them first.`);
  const loose = (buckets ?? []).filter(b => !claims.some(c => c.bucketName === b.name));
  if (loose.length) out.push(`Buckets in Ceph: ${loose.slice(0, 5).map(b => b.name).join(', ')}${loose.length > 5 ? '…' : ''}. Rook keeps the store while buckets exist.`);
  return out;
}

/** The S3 credentials in a user's or claim's Secret, decoded. Values are never logged or stored. */
export function decodeCredentials(secret: any): { accessKey: string; secretKey: string; endpoint: string } | null {
  const d = obj(secret?.data);
  const dec = (v: unknown) => {
    try {
      return v ? atob(str(v)) : '';
    } catch {
      return '';
    }
  };
  const accessKey = dec(d.AccessKey ?? d.AWS_ACCESS_KEY_ID);
  const secretKey = dec(d.SecretKey ?? d.AWS_SECRET_ACCESS_KEY);
  if (!accessKey && !secretKey) return null;
  return { accessKey, secretKey, endpoint: dec(d.Endpoint) };
}
