import {
  bucketClaimObj,
  bucketClassObj,
  bucketNameProblem,
  claimForBucket,
  claimInfo,
  classStore,
  decodeCredentials,
  DEFAULT_STORE_FORM,
  isBucketClass,
  objectStoreCR,
  objectUserCR,
  parseBucketStats,
  parseRgwUser,
  parseUidList,
  rgwArgs,
  rgwPods,
  storeClaims,
  storeClasses,
  storeDeleteBlockers,
  storeFormProblems,
  storeInfo,
  storePools,
  storeUsersOf,
  userFormProblems,
  userRows,
} from './object';
import { Obj, Pool } from './types';

/* Real answers from a test cluster after Cairn created test-store and test-user (Ceph 20.2.4, Rook 1.21.2). The key fields are placeholders: the bridge blanks secret keys, the test never held real ones. */
const USER_INFO = {
  user_id: 'test-user',
  display_name: 'Cairn test user',
  email: '',
  suspended: 0,
  max_buckets: 5,
  subusers: [],
  keys: [{ user: 'test-user', access_key: 'PLACEHOLDER', secret_key: '', active: true, create_date: '2026-11-23T03:34:13.683591Z' }],
  swift_keys: [],
  caps: [],
  op_mask: 'read, write, delete',
  default_placement: '',
  default_storage_class: '',
  placement_tags: [],
  bucket_quota: { enabled: false, check_on_raw: false, max_size: -1, max_size_kb: 0, max_objects: -1 },
  user_quota: { enabled: true, check_on_raw: false, max_size: 1073741824, max_size_kb: 1048576, max_objects: -1 },
  temp_url_keys: [],
  type: 'rgw',
  mfa_ids: [],
  account_id: '',
  path: '/',
  create_date: '2026-11-23T03:34:13.682541Z',
  tags: [],
  group_ids: [],
};

const STORE: Obj = {
  apiVersion: 'ceph.rook.io/v1',
  kind: 'CephObjectStore',
  metadata: { name: 'test-store', namespace: 'rook-ceph' },
  spec: {
    metadataPool: { failureDomain: 'host', replicated: { size: 3 } },
    dataPool: { failureDomain: 'host', replicated: { size: 3 } },
    preservePoolsOnDelete: false,
    gateway: { port: 80, instances: 1, resources: { requests: { cpu: '100m', memory: '256Mi' }, limits: { memory: '1Gi' } } },
  },
  status: {
    endpoints: { insecure: ['http://rook-ceph-rgw-test-store.rook-ceph.svc:80'], secure: [] },
    info: { endpoint: 'http://rook-ceph-rgw-test-store.rook-ceph.svc:80' },
    message: 'Object store configured successfully',
    phase: 'Ready',
    replicas: 1,
  },
};

const RGW_POD: Obj = {
  metadata: { name: 'rook-ceph-rgw-test-store-a-7bc5bc6746-7ktht', labels: { app: 'rook-ceph-rgw', rook_object_store: 'test-store', rgw: 'test-store' } },
  spec: { nodeName: 'kube-node-3.example.com' },
  status: { phase: 'Running', containerStatuses: [{ ready: true }] },
};

/* The shape of "radosgw-admin bucket stats" (one bucket made by a claim). */
const BUCKET_STATS = [
  {
    bucket: 'test-bucket-6f1c',
    num_shards: 11,
    tenant: '',
    versioning: 'off',
    zonegroup: 'zg-id',
    placement_rule: 'default-placement',
    explicit_placement: { data_pool: '', data_extra_pool: '', index_pool: '' },
    id: 'b-id',
    marker: 'b-id',
    index_type: 'Normal',
    owner: 'obc-test-cairn-obj-test-bucket',
    ver: '0#1',
    mtime: '2026-11-23T03:40:00.000000Z',
    creation_time: '2026-11-23T03:40:00.000000Z',
    usage: { 'rgw.main': { size: 1000, size_actual: 4096, size_utilized: 1000, size_kb: 1, size_kb_actual: 4, size_kb_utilized: 1, num_objects: 2 } },
    bucket_quota: { enabled: true, check_on_raw: false, max_size: 2147483648, max_size_kb: 2097152, max_objects: 100 },
  },
  { bucket: 'empty', owner: 'test-user', usage: {}, bucket_quota: { enabled: false, max_size: -1, max_objects: -1 } },
];

const pool = (id: number, name: string, stored = 0): Pool => ({ id, name, usage: { stored } } as unknown as Pool);

describe('stores', () => {
  it('reads a store resource and its gateways', () => {
    const i = storeInfo(STORE, [RGW_POD, { ...RGW_POD, metadata: { name: 'x', labels: { app: 'rook-ceph-rgw', rook_object_store: 'other' } } }]);
    expect(i).toMatchObject({
      name: 'test-store',
      phase: 'Ready',
      endpoints: ['http://rook-ceph-rgw-test-store.rook-ceph.svc:80'],
      port: 80,
      instances: 1,
      readyPods: 1,
      zone: '',
      shared: false,
    });
    expect(i.pods).toHaveLength(1);
    expect(rgwPods('test-store', [RGW_POD])).toHaveLength(1);
    const bare = storeInfo({ ...STORE, status: { info: { endpoint: 'http://e:80' } } }, []);
    expect(bare.endpoints).toEqual(['http://e:80']);
  });

  it('selects the realm, zone group and zone for radosgw-admin', () => {
    expect(rgwArgs(STORE)).toEqual(['--rgw-realm', 'test-store', '--rgw-zonegroup', 'test-store', '--rgw-zone', 'test-store']);
    expect(rgwArgs({ ...STORE, spec: { zone: { name: 'zone-a' } } })).toEqual(['--rgw-zone', 'zone-a']);
  });

  it('finds the store pools', () => {
    const pools = [pool(1, 'vm-pool'), pool(3, '.rgw.root'), pool(10, 'test-store.rgw.control'), pool(16, 'test-store.rgw.buckets.data', 5), pool(4, 'default.rgw.log')];
    expect(storePools('test-store', pools).map(p => p.name)).toEqual(['.rgw.root', 'test-store.rgw.control', 'test-store.rgw.buckets.data']);
  });
});

describe('users and buckets', () => {
  it('parses a user without keeping any key', () => {
    const u = parseRgwUser(USER_INFO);
    expect(u).toMatchObject({
      uid: 'test-user',
      displayName: 'Cairn test user',
      suspended: false,
      maxBuckets: 5,
      keyCount: 1,
      swiftKeyCount: 0,
      caps: [],
      opMask: 'read, write, delete',
      userQuota: { enabled: true, maxSizeBytes: 1073741824, maxObjects: null },
      bucketQuota: { enabled: false, maxSizeBytes: null, maxObjects: null },
    });
    expect(JSON.stringify(u)).not.toContain('PLACEHOLDER');
    expect(parseUidList(['dashboard-admin', 'test-user'])).toEqual(['dashboard-admin', 'test-user']);
    expect(parseUidList(null)).toEqual([]);
  });

  it('parses bucket stats', () => {
    const b = parseBucketStats(BUCKET_STATS);
    expect(b[0]).toMatchObject({
      name: 'test-bucket-6f1c',
      owner: 'obc-test-cairn-obj-test-bucket',
      shards: 11,
      objects: 2,
      sizeBytes: 1000,
      sizeActualBytes: 4096,
      placement: 'default-placement',
      quota: { enabled: true, maxSizeBytes: 2147483648, maxObjects: 100 },
      versioning: 'off',
    });
    expect(b[0].created).toBe(Date.parse('2026-11-23T03:40:00Z'));
    expect(b[1]).toMatchObject({ name: 'empty', objects: 0, sizeBytes: 0 });
    expect(parseBucketStats([])).toEqual([]);
    expect(parseBucketStats({ bucket: 'one', usage: {} })).toHaveLength(1);
  });

  it('merges user resources with radosgw users', () => {
    const cr: Obj = { metadata: { name: 'test-user', namespace: 'rook-ceph' }, spec: { store: 'test-store' } };
    const other: Obj = { metadata: { name: 'x', namespace: 'rook-ceph' }, spec: { store: 'other' } };
    expect(storeUsersOf(STORE, [cr, other])).toEqual([cr]);
    const infos = new Map([['test-user', parseRgwUser(USER_INFO)]]);
    const rows = userRows([cr], ['dashboard-admin', 'test-user', 'obc-test-cairn-obj-test-bucket'], infos, parseBucketStats(BUCKET_STATS));
    expect(rows.map(r => r.uid)).toEqual(['dashboard-admin', 'obc-test-cairn-obj-test-bucket', 'test-user']);
    expect(rows[1]).toMatchObject({ forClaim: true, buckets: 1, bytes: 1000, objects: 2 });
    expect(rows[2].cr).toBe(cr);
    expect(rows[2].rgw?.displayName).toBe('Cairn test user');
    expect(rows[2].buckets).toBe(1);
  });
});

describe('claims and classes', () => {
  const sc = bucketClassObj({ name: 'test-bucket-sc', rookNs: 'rook-ceph', store: 'test-store', storeNs: 'rook-ceph', reclaim: 'Delete' });
  const obc: Obj = {
    ...bucketClaimObj({ name: 'test-bucket', namespace: 'test-cairn-obj', storageClass: 'test-bucket-sc' }),
    spec: { storageClassName: 'test-bucket-sc', generateBucketName: 'test-bucket', bucketName: 'test-bucket-6f1c', objectBucketName: 'obc-test-cairn-obj-test-bucket' },
    status: { phase: 'Bound' },
  };

  it('builds the bucket StorageClass and claim', () => {
    expect(sc).toEqual({
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: { name: 'test-bucket-sc' },
      provisioner: 'rook-ceph.ceph.rook.io/bucket',
      reclaimPolicy: 'Delete',
      parameters: { objectStoreName: 'test-store', objectStoreNamespace: 'rook-ceph' },
    });
    expect(isBucketClass(sc)).toBe(true);
    expect(isBucketClass({ metadata: { name: 'ceph-rbd' }, provisioner: 'rook-ceph.rbd.csi.ceph.com' })).toBe(false);
    expect(classStore(sc)).toEqual({ name: 'test-store', namespace: 'rook-ceph' });
    expect(bucketClaimObj({ name: 'test-bucket', namespace: 'test-cairn-obj', storageClass: 'test-bucket-sc', maxObjects: '100', maxSize: '2G' })).toEqual({
      apiVersion: 'objectbucket.io/v1alpha1',
      kind: 'ObjectBucketClaim',
      metadata: { name: 'test-bucket', namespace: 'test-cairn-obj' },
      spec: { storageClassName: 'test-bucket-sc', generateBucketName: 'test-bucket', additionalConfig: { maxObjects: '100', maxSize: '2G' } },
    });
    expect(bucketClaimObj({ name: 'a', namespace: 'n', storageClass: 's', bucketName: 'fixed' }).spec).toEqual({ storageClassName: 's', bucketName: 'fixed' });
  });

  it('maps claims to stores and buckets', () => {
    const c = claimInfo(obc, [sc]);
    expect(c).toMatchObject({
      name: 'test-bucket',
      namespace: 'test-cairn-obj',
      bucketName: 'test-bucket-6f1c',
      phase: 'Bound',
      secretName: 'test-bucket',
      configMapName: 'test-bucket',
      store: { name: 'test-store', namespace: 'rook-ceph' },
    });
    expect(storeClasses(STORE, [sc, { metadata: { name: 'x' }, provisioner: 'rook-ceph.ceph.rook.io/bucket', parameters: { objectStoreName: 'other' } }])).toEqual([sc]);
    const claims = storeClaims(STORE, [obc], [sc]);
    expect(claims).toHaveLength(1);
    expect(claimForBucket('test-bucket-6f1c', claims)?.name).toBe('test-bucket');
    expect(claimForBucket('nope', claims)).toBeUndefined();
  });

  it('says what blocks deleting a store', () => {
    const user: Obj = { metadata: { name: 'test-user', namespace: 'rook-ceph' }, spec: { store: 'test-store' } };
    const why = storeDeleteBlockers(STORE, [user], [obc], [sc], parseBucketStats(BUCKET_STATS));
    expect(why[0]).toContain('test-user');
    expect(why[1]).toContain('test-cairn-obj/test-bucket');
    expect(why[2]).toContain('empty');
    expect(storeDeleteBlockers(STORE, [], [], [sc], [])).toEqual([]);
  });
});

describe('builders and forms', () => {
  it('builds the sample test-store', () => {
    const cr = objectStoreCR({ ...DEFAULT_STORE_FORM, name: 'test-store', cpuRequest: '100m', memRequest: '256Mi', memLimit: '1Gi', preservePools: false });
    const { status, ...spec } = STORE;
    expect(status.phase).toBe('Ready');
    expect(cr).toEqual(spec);
    const ec = objectStoreCR({ ...DEFAULT_STORE_FORM, name: 's', dataEc: { k: 2, m: 1 } });
    expect(ec.spec.dataPool).toEqual({ failureDomain: 'host', erasureCoded: { dataChunks: 2, codingChunks: 1 } });
  });

  it('checks the store form', () => {
    const ok = { ...DEFAULT_STORE_FORM, name: 'test-store' };
    expect(storeFormProblems(ok, new Set())).toEqual({});
    expect(storeFormProblems(ok, new Set(['test-store'])).name).toMatch(/exists/);
    expect(storeFormProblems({ ...ok, dataEc: { k: 4, m: 2 } }, new Set(), 3).data).toMatch(/6 hosts/);
    expect(storeFormProblems({ ...ok, port: 0 }, new Set()).port).toMatch(/port/);
    expect(storeFormProblems({ ...ok, memLimit: 'big' }, new Set()).memLimit).toMatch(/quantity/);
  });

  it('builds a user with caps and quotas', () => {
    const f = { name: 'test-user', namespace: 'rook-ceph', store: 'test-store', displayName: 'Cairn test user', caps: { buckets: 'read' as const, users: '' as const }, maxBuckets: '5', maxSize: '1Gi', maxObjects: '' };
    expect(objectUserCR(f)).toEqual({
      apiVersion: 'ceph.rook.io/v1',
      kind: 'CephObjectStoreUser',
      metadata: { name: 'test-user', namespace: 'rook-ceph' },
      spec: { store: 'test-store', displayName: 'Cairn test user', capabilities: { buckets: 'read' }, quotas: { maxBuckets: 5, maxSize: '1Gi' } },
    });
    expect(userFormProblems(f, new Set())).toEqual({});
    expect(userFormProblems({ ...f, maxBuckets: 'x' }, new Set()).maxBuckets).toBeTruthy();
    expect(userFormProblems(f, new Set(['test-user'])).name).toMatch(/already/);
  });

  it('checks bucket names', () => {
    expect(bucketNameProblem('')).toBeNull();
    expect(bucketNameProblem('my-bucket.data')).toBeNull();
    expect(bucketNameProblem('ab')).toMatch(/3 to 63/);
    expect(bucketNameProblem('Bad')).toMatch(/Lowercase/);
    expect(bucketNameProblem('10.0.0.1')).toMatch(/IP/);
  });

  it('decodes S3 credentials from a Secret', () => {
    const s = { data: { AccessKey: btoa('ACCESS-PLACEHOLDER'), SecretKey: btoa('SECRET-PLACEHOLDER'), Endpoint: btoa('http://e:80') } };
    expect(decodeCredentials(s)).toEqual({ accessKey: 'ACCESS-PLACEHOLDER', secretKey: 'SECRET-PLACEHOLDER', endpoint: 'http://e:80' });
    const obcSecret = { data: { AWS_ACCESS_KEY_ID: btoa('A'), AWS_SECRET_ACCESS_KEY: btoa('B') } };
    expect(decodeCredentials(obcSecret)).toEqual({ accessKey: 'A', secretKey: 'B', endpoint: '' });
    expect(decodeCredentials({ data: {} })).toBeNull();
  });
});
