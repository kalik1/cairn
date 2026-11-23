import {
  buildBlockPool,
  createImpact,
  defaultPoolForm,
  deleteBlockers,
  domainCounts,
  editImpact,
  filesystemPools,
  formFromCr,
  objectStoresSharing,
  ownerLabel,
  parseQuantity,
  pgTone,
  poolOwner,
  poolPgStates,
  poolProblems,
  poolState,
  poolStrata,
  pvsUsing,
  snapshotClassesFor,
  storageClassesUsing,
  typeLabel,
} from './pools';
import { CrushBucket, Obj, Osd, Pool } from './types';

const cr = (kind: string, name: string, spec: any = {}, ns = 'rook-ceph'): Obj => ({
  apiVersion: 'ceph.rook.io/v1',
  kind,
  metadata: { name, namespace: ns },
  spec,
});

// A sample vm-pool CephBlockPool (rook-ceph, Rook 1.21).
const VM_POOL_CR: Obj = {
  ...cr('CephBlockPool', 'vm-pool', {
    failureDomain: 'host',
    parameters: { compression_mode: 'none' },
    replicated: { requireSafeReplicaSize: true, size: 3 },
  }),
  metadata: { name: 'vm-pool', namespace: 'rook-ceph', resourceVersion: '729466', uid: 'e173549d', finalizers: ['cephblockpool.ceph.rook.io'] },
  status: { phase: 'Ready', poolID: 1 },
};

const SC_RBD: Obj = {
  apiVersion: 'storage.k8s.io/v1',
  kind: 'StorageClass',
  metadata: { name: 'ceph-rbd' },
  provisioner: 'rook-ceph.rbd.csi.ceph.com',
  parameters: { clusterID: 'rook-ceph', pool: 'vm-pool', imageFeatures: 'layering' },
};
const SC_LVM: Obj = { kind: 'StorageClass', metadata: { name: 'topolvm-provisioner' }, provisioner: 'topolvm.io', parameters: { pool: 'vm-pool' } };

const pv = (name: string, pool: string, claim: [string, string], image = 'csi-vol-1', driver = 'rook-ceph.rbd.csi.ceph.com'): Obj => ({
  kind: 'PersistentVolume',
  metadata: { name },
  spec: { claimRef: { namespace: claim[0], name: claim[1] }, csi: { driver, volumeAttributes: { clusterID: 'rook-ceph', pool, imageName: image } } },
});

const pool = (over: Partial<Pool> = {}): Pool => ({
  id: 1,
  name: 'vm-pool',
  type: 'replicated',
  size: 3,
  minSize: 2,
  crushRuleId: 1,
  crushRule: 'vm-pool',
  pgNum: 32,
  pgpNum: 32,
  pgNumTarget: 32,
  autoscaleMode: 'on',
  applications: ['rbd'],
  compressionMode: 'none',
  ecProfile: '',
  flags: ['hashpspool', 'selfmanaged_snaps'],
  quotaBytes: 0,
  quotaObjects: 0,
  rawFactor: 3,
  ...over,
});

describe('ownership', () => {
  const ctx = {
    blockPools: [VM_POOL_CR, cr('CephBlockPool', 'builtin-nfs', { name: '.nfs', replicated: { size: 3 } })],
    filesystems: [cr('CephFilesystem', 'myfs', { metadataPool: { replicated: { size: 3 } }, dataPools: [{ replicated: { size: 3 } }, { name: 'ec', erasureCoded: {} }] })],
    objectStores: [cr('CephObjectStore', 'store', {})],
  };

  it('finds the CephBlockPool by name or spec.name', () => {
    expect(poolOwner({ name: 'vm-pool' }, ctx)).toMatchObject({ kind: 'CephBlockPool', name: 'vm-pool' });
    expect(poolOwner({ name: '.nfs' }, ctx)).toMatchObject({ kind: 'CephBlockPool', name: 'builtin-nfs' });
  });

  it('falls back to the pool id in the CephBlockPool status', () => {
    expect(poolOwner({ id: 1, name: 'renamed' }, ctx)).toMatchObject({ kind: 'CephBlockPool', name: 'vm-pool' });
    expect(poolOwner({ id: 7, name: 'renamed' }, ctx).kind).toBe('unmanaged');
  });

  it('names filesystem pools the way Rook does', () => {
    expect(filesystemPools(ctx.filesystems[0]).map(p => p.name)).toEqual(['myfs-metadata', 'myfs-data0', 'myfs-ec']);
    expect(poolOwner({ name: 'myfs-ec' }, ctx)).toMatchObject({ kind: 'CephFilesystem', name: 'myfs', role: 'data' });
    expect(poolOwner({ name: 'myfs-metadata' }, ctx).about).toContain('spec.metadataPool');
  });

  it('uses fs ls for filesystems Rook did not name', () => {
    const o = poolOwner({ name: 'cephfs.x.data' }, { ...ctx, cephFs: [{ name: 'x', metadata_pool: 'cephfs.x.meta', data_pools: ['cephfs.x.data'] }] });
    expect(o).toMatchObject({ kind: 'unmanaged', name: 'x', role: 'data' });
    expect(ownerLabel(o)).toBe('Ceph filesystem x');
  });

  it('finds object store pools and the shared .rgw.root', () => {
    expect(poolOwner({ name: 'store.rgw.buckets.data' }, ctx)).toMatchObject({ kind: 'CephObjectStore', name: 'store', role: 'object data' });
    expect(poolOwner({ name: 'store.rgw.buckets.index' }, ctx).about).toContain('spec.metadataPool');
    expect(poolOwner({ name: '.rgw.root' }, ctx).kind).toBe('CephObjectStore');
    // Seen on a test cluster: radosgw-admin made .rgw.root and default.rgw.* with no object store.
    const bare = { blockPools: [VM_POOL_CR], filesystems: [], objectStores: [] };
    expect(poolOwner({ name: '.rgw.root' }, bare)).toMatchObject({ kind: 'unmanaged' });
    expect(poolOwner({ name: 'default.rgw.log' }, bare).kind).toBe('unmanaged');
  });

  it('knows the pools Rook creates by itself', () => {
    const bare = { blockPools: [], filesystems: [], objectStores: [] };
    expect(poolOwner({ name: '.mgr' }, bare)).toMatchObject({ kind: 'builtin' });
    expect(ownerLabel(poolOwner({ name: '.mgr' }, bare))).toBe('Rook (built in)');
    expect(ownerLabel(poolOwner({ name: 'vm-pool' }, ctx))).toBe('CephBlockPool vm-pool');
  });
});

describe('Kubernetes use', () => {
  it('finds StorageClasses by pool, dataPool and topology, for this cluster only', () => {
    const ec: Obj = { ...SC_RBD, metadata: { name: 'ec' }, parameters: { clusterID: 'rook-ceph', pool: 'meta', dataPool: 'vm-pool' } };
    const other: Obj = { ...SC_RBD, metadata: { name: 'other' }, parameters: { clusterID: 'elsewhere', pool: 'vm-pool' } };
    const topo: Obj = {
      ...SC_RBD,
      metadata: { name: 'topo' },
      parameters: { clusterID: 'rook-ceph', topologyConstrainedPools: JSON.stringify([{ poolName: 'vm-pool', domainSegments: [] }]) },
    };
    const uses = storageClassesUsing('vm-pool', [SC_RBD, SC_LVM, ec, other, topo], 'rook-ceph');
    expect(uses.map(u => [u.sc.metadata.name, u.via])).toEqual([
      ['ceph-rbd', 'pool'],
      ['ec', 'dataPool'],
      ['topo', 'topology'],
    ]);
  });

  it('finds PVs in the pool and snapshot classes of the same driver', () => {
    const pvs = [pv('a', 'vm-pool', ['demo', 'x']), pv('b', 'other', ['demo', 'y']), pv('c', 'vm-pool', ['demo', 'z'], 'i', 'topolvm.io')];
    expect(pvsUsing('vm-pool', pvs, 'rook-ceph').map(p => p.metadata.name)).toEqual(['a']);
    const classes: Obj[] = [
      { kind: 'VolumeSnapshotClass', metadata: { name: 'ceph-rbd-snapshot' }, driver: 'rook-ceph.rbd.csi.ceph.com', parameters: { clusterID: 'rook-ceph' } },
      { kind: 'VolumeSnapshotClass', metadata: { name: 'topolvm-snapshot' }, driver: 'topolvm.io' },
    ];
    expect(snapshotClassesFor(storageClassesUsing('vm-pool', [SC_RBD]), classes, 'rook-ceph').map(c => c.metadata.name)).toEqual(['ceph-rbd-snapshot']);
  });

  it('finds object stores sharing a pool', () => {
    const st = cr('CephObjectStore', 's', { sharedPools: { metadataPoolName: 'rgw-meta', dataPoolName: 'rgw-data' } });
    expect(objectStoresSharing('rgw-data', [st])).toHaveLength(1);
    expect(objectStoresSharing('vm-pool', [st])).toHaveLength(0);
  });
});

describe('PG states', () => {
  it('gives each state a tone', () => {
    expect(pgTone('active+clean')).toBe('ok');
    expect(pgTone('active+clean+scrubbing+deep')).toBe('move');
    expect(pgTone('active+undersized+degraded')).toBe('warn');
    expect(pgTone('active+remapped+backfilling')).toBe('move');
    expect(pgTone('peering')).toBe('move');
    expect(pgTone('down')).toBe('err');
    expect(pgTone('active+clean+inconsistent')).toBe('err');
    expect(pgTone('undersized+degraded+peered')).toBe('move');
    expect(pgTone('stale+active+clean')).toBe('err');
  });

  it('summarizes a pool, worst first', () => {
    const pgs = [
      { pgid: '1.0', pool: 1, state: 'active+clean', up: [], acting: [], primary: 0 },
      { pgid: '1.1', pool: 1, state: 'active+undersized+degraded', up: [], acting: [], primary: 0 },
      { pgid: '2.0', pool: 2, state: 'down', up: [], acting: [], primary: 0 },
    ];
    expect(poolPgStates(pgs, 1).map(s => s.state)).toEqual(['active+undersized+degraded', 'active+clean']);
    expect(poolState(pool(), pgs)).toMatchObject({ tone: 'warn', word: 'Degraded' });
    expect(poolState(pool(), pgs.slice(0, 1))).toMatchObject({ tone: 'ok', word: 'Clean' });
    expect(poolState(pool({ flags: ['full_quota'] }), pgs)).toMatchObject({ tone: 'err', word: 'Quota reached' });
    expect(poolState(pool({ id: 2 }), pgs).tone).toBe('err');
    const scrub = [{ pgid: '1.0', pool: 1, state: 'active+clean+scrubbing', up: [], acting: [], primary: 0 }];
    expect(poolState(pool(), scrub)).toMatchObject({ tone: 'ok', word: 'Clean, scrubbing' });
  });

  it('labels types', () => {
    expect(typeLabel(pool())).toBe('Replicated, 3 copies (min 2)');
    expect(typeLabel(pool({ type: 'erasure', ec: { k: 4, m: 2 } }))).toBe('Erasure coded 4+2');
  });
});

// A sample CRUSH map: root default → 3 hosts → one hdd OSD each.
const BUCKETS: CrushBucket[] = [
  { id: -1, name: 'default', type: 'root', children: [-3, -5, -7], sizeBytes: 0, usedBytes: 0, utilization: 0 },
  { id: -3, name: 'kube-bootstrap', type: 'host', children: [0], sizeBytes: 0, usedBytes: 0, utilization: 0 },
  { id: -5, name: 'kube-worker-a', type: 'host', children: [1], sizeBytes: 0, usedBytes: 0, utilization: 0 },
  { id: -7, name: 'kube-worker-b', type: 'host', children: [2], sizeBytes: 0, usedBytes: 0, utilization: 0 },
];
const osd = (id: number, over: Partial<Osd> = {}): Osd =>
  ({ id, name: `osd.${id}`, host: '', deviceClass: 'hdd', in: true, up: true, pgs: 33, ...over } as Osd);
const OSDS = [osd(0), osd(1), osd(2)];

describe('failure domains', () => {
  it('counts hosts and OSDs per device class', () => {
    expect(domainCounts(BUCKETS, OSDS)).toEqual({ osd: 3, host: 3 });
    expect(domainCounts(BUCKETS, OSDS, 'ssd')).toEqual({ osd: 0 });
    expect(domainCounts(BUCKETS, [osd(0), osd(1, { in: false }), osd(2)])).toEqual({ osd: 2, host: 2 });
  });
});

describe('the CephBlockPool form', () => {
  const ctx = { cephPools: ['vm-pool', '.mgr'], crs: ['vm-pool'], domains: { host: 3, osd: 3 }, deviceClasses: ['hdd'] };

  it('builds the sample test pool', () => {
    const f = { ...defaultPoolForm(), name: 'test-pool' };
    expect(poolProblems(f, ctx, 'create')).toEqual([]);
    expect(buildBlockPool(f, 'rook-ceph')).toEqual({
      apiVersion: 'ceph.rook.io/v1',
      kind: 'CephBlockPool',
      metadata: { name: 'test-pool', namespace: 'rook-ceph' },
      spec: { failureDomain: 'host', replicated: { size: 3, requireSafeReplicaSize: true } },
    });
  });

  it('writes compression, quotas, ratio, autoscale, stats and device class', () => {
    const f = {
      ...defaultPoolForm(),
      name: 'test-pool',
      deviceClass: 'hdd',
      compression: 'aggressive' as const,
      compressionAlgorithm: 'zstd',
      quotaMaxSize: '10Gi',
      quotaMaxObjects: '1000',
      targetSizeRatio: '0.2',
      autoscale: 'warn' as const,
      rbdStats: true,
    };
    expect(buildBlockPool(f, 'rook-ceph').spec).toEqual({
      failureDomain: 'host',
      deviceClass: 'hdd',
      replicated: { size: 3, requireSafeReplicaSize: true, targetSizeRatio: 0.2 },
      parameters: { compression_mode: 'aggressive', compression_algorithm: 'zstd', pg_autoscale_mode: 'warn' },
      quotas: { maxSize: '10Gi', maxObjects: 1000 },
      enableRBDStats: true,
    });
  });

  it('builds an erasure-coded pool', () => {
    const f = { ...defaultPoolForm(), name: 'test-ec', type: 'erasure' as const, k: 2, m: 1, targetSizeRatio: '0.1' };
    expect(buildBlockPool(f, 'rook-ceph').spec).toEqual({
      failureDomain: 'host',
      erasureCoded: { dataChunks: 2, codingChunks: 1 },
      parameters: { target_size_ratio: '0.1' },
    });
  });

  it('round-trips the sample vm-pool without changes', () => {
    const f = formFromCr(VM_POOL_CR);
    expect(f).toMatchObject({ name: 'vm-pool', type: 'replicated', size: 3, failureDomain: 'host', compression: 'none', autoscale: 'on' });
    const after = buildBlockPool(f, 'rook-ceph', VM_POOL_CR);
    expect(after.spec).toEqual(VM_POOL_CR.spec);
    expect(after.metadata.resourceVersion).toBe('729466');
    expect(after.status).toBeUndefined();
  });

  it('keeps fields Cairn does not manage and clears quotas with 0', () => {
    const base = cr('CephBlockPool', 'p', {
      failureDomain: 'host',
      replicated: { size: 3, hybridStorage: { primaryDeviceClass: 'ssd', secondaryDeviceClass: 'hdd' } },
      mirroring: { enabled: true, mode: 'image' },
      quotas: { maxSize: '10Gi', maxObjects: 5 },
    });
    const f = { ...formFromCr(base), quotaMaxSize: '', quotaMaxObjects: '' };
    const s = buildBlockPool(f, 'rook-ceph', base).spec;
    expect(s.mirroring).toEqual({ enabled: true, mode: 'image' });
    expect(s.replicated.hybridStorage).toEqual({ primaryDeviceClass: 'ssd', secondaryDeviceClass: 'hdd' });
    expect(s.quotas).toEqual({ maxSize: '0', maxObjects: 0 });
    // A cleared quota reads back as none.
    expect(formFromCr({ ...base, spec: s })).toMatchObject({ quotaMaxSize: '', quotaMaxObjects: '' });
  });

  it('allows one copy only with requireSafeReplicaSize off', () => {
    const f = { ...defaultPoolForm(), name: 'test-one', size: 1 };
    expect(buildBlockPool(f, 'rook-ceph').spec.replicated).toEqual({ size: 1, requireSafeReplicaSize: false });
    expect(poolProblems(f, ctx, 'create')).toEqual([expect.objectContaining({ field: 'size', level: 'warn' })]);
  });

  it('validates names, failure domains and quantities', () => {
    const p = (over: any, mode: 'create' | 'edit' = 'create', before?: any) =>
      poolProblems({ ...defaultPoolForm(), name: 'test-pool', ...over }, ctx, mode, before).map(x => `${x.level}:${x.field}`);
    expect(p({ name: '' })).toEqual(['error:name']);
    expect(p({ name: 'Bad_Name' })).toEqual(['error:name']);
    expect(p({ name: 'vm-pool' })).toEqual(['error:name']);
    expect(p({ name: '.mgr' })).toEqual(['error:name']);
    expect(p({ size: 4 })).toEqual(['error:failureDomain']);
    expect(p({ failureDomain: 'rack' })).toEqual(['error:failureDomain']);
    expect(p({ size: 4, failureDomain: 'osd' })).toEqual(['error:failureDomain']);
    expect(p({ type: 'erasure', k: 2, m: 1 })).toEqual(['warn:m']);
    expect(p({ type: 'erasure', k: 2, m: 2 })).toEqual(['error:failureDomain']);
    expect(p({ deviceClass: 'nvme' })).toEqual(['error:deviceClass']);
    expect(p({ quotaMaxSize: '10 GB' })).toEqual(['error:quotaMaxSize']);
    expect(p({ quotaMaxObjects: '1e3' })).toEqual(['error:quotaMaxObjects']);
    expect(p({ targetSizeRatio: '-1' })).toEqual(['error:targetSizeRatio']);
    const before = { ...defaultPoolForm(), name: 'test-pool' };
    expect(p({ type: 'erasure' }, 'edit', before)).toContain('error:type');
  });

  it('parses Kubernetes quantities', () => {
    expect(parseQuantity('10Gi')).toBe(10 * 2 ** 30);
    expect(parseQuantity('10G')).toBe(10e9);
    expect(parseQuantity('1.5Ti')).toBe(1.5 * 2 ** 40);
    expect(parseQuantity('512')).toBe(512);
    expect(parseQuantity('10 G')).toBeNull();
    expect(parseQuantity('10GB')).toBeNull();
  });
});

describe('impact', () => {
  const c = {
    domains: { host: 3, osd: 3 },
    osds: 3,
    rawAvail: 227616804864,
    rawTotal: 257698037760,
    fullRatio: 0.95,
    defaultPgNum: 32,
    maxPgPerOsd: 250,
    maxPgsNow: 33,
  };

  it('tells what a new replicated pool costs', () => {
    const i = createImpact({ ...defaultPoolForm(), name: 'test-pool' }, c);
    expect(i.rawPerByte).toBe(3);
    expect(i.needDomains).toBe(3);
    expect(i.haveDomains).toBe(3);
    expect(i.pgPerOsdAfter).toBe(65);
    expect(i.usable).toBeCloseTo((227616804864 - 0.05 * 257698037760) / 3, -3);
    expect(i.lines.map(l => l.tone)).toEqual(['idle', 'ok', 'idle', 'idle']);
  });

  it('flags too many PGs per OSD and missing domains', () => {
    const i = createImpact({ ...defaultPoolForm(), name: 'x', type: 'erasure', k: 4, m: 2 }, { ...c, maxPgsNow: 200 });
    expect(i.rawPerByte).toBe(1.5);
    expect(i.lines.filter(l => l.tone === 'err')).toHaveLength(3);
  });

  it('warns when an edit moves data or stops writes', () => {
    const before = formFromCr(VM_POOL_CR);
    const usage = { stored: 9145945383, objects: 2809 };
    const up = editImpact(before, { ...before, size: 4 }, usage);
    expect(up.movesData).toBe(true);
    expect(up.lines[0].text).toContain('8.52 GiB more raw space');
    expect(editImpact(before, { ...before, size: 1 }, usage).danger).toBe(true);
    expect(editImpact(before, { ...before, failureDomain: 'osd' }, usage).movesData).toBe(true);
    expect(editImpact(before, { ...before, compression: 'aggressive' }, usage).lines[0].text).toContain('new writes only');
    const q = editImpact(before, { ...before, quotaMaxSize: '1Gi' }, usage);
    expect(q.danger).toBe(true);
    expect(editImpact(before, { ...before, quotaMaxSize: '100Gi' }, usage).danger).toBe(false);
    expect(editImpact(before, { ...before, quotaMaxObjects: '100' }, usage).danger).toBe(true);
    expect(editImpact(before, before, usage).lines).toEqual([]);
  });
});

describe('delete guards', () => {
  const owner = poolOwner({ name: 'vm-pool' }, { blockPools: [VM_POOL_CR], filesystems: [], objectStores: [] });
  const base = { pool: 'vm-pool', owner, storageClasses: [], pvs: [], images: [], trash: 0, radosNamespaces: [], objectStores: [] };

  it('lets an empty CephBlockPool go', () => {
    expect(deleteBlockers(base)).toEqual([]);
  });

  it('says exactly what is in the way', () => {
    const b = deleteBlockers({
      ...base,
      storageClasses: storageClassesUsing('vm-pool', [SC_RBD]),
      pvs: [pv('pv1', 'vm-pool', ['demo', 'gpu-vm-3-rootdisk'])],
      images: ['csi-vol-1', 'csi-vol-2'],
      trash: 1,
      radosNamespaces: [cr('CephBlockPoolRadosNamespace', 'tenant-a', { blockPoolName: 'vm-pool' })],
    });
    expect(b).toHaveLength(5);
    expect(b[0]).toContain('StorageClass ceph-rbd provisions');
    expect(b[1]).toContain('demo/gpu-vm-3-rootdisk');
    expect(b[2]).toContain('2 RBD images (csi-vol-1, csi-vol-2)');
    expect(b[3]).toContain('1 image is in its RBD trash');
    expect(b[4]).toContain('tenant-a');
  });

  it('refuses pools no CephBlockPool owns, and unknown image lists', () => {
    const mgr = poolOwner({ name: '.mgr' }, { blockPools: [], filesystems: [], objectStores: [] });
    expect(deleteBlockers({ ...base, pool: '.mgr', owner: mgr })[0]).toContain('only pools a CephBlockPool owns');
    expect(deleteBlockers({ ...base, images: null, listError: 'timeout' })[0]).toContain('could not list the RBD images in it (timeout)');
  });
});

describe('capacity strata', () => {
  it('splits raw space into stored, overhead and free', () => {
    const p = pool({
      usage: {
        stored: 9145945383,
        storedRaw: 27437834240,
        used: 27437980533,
        maxAvail: 70895935488,
        percentUsed: 0.114,
        objects: 2809,
        quotaBytes: 0,
        quotaObjects: 0,
        compressBytesUsed: 0,
        compressUnderBytes: 0,
        rdOps: 0,
        rdBytes: 0,
        wrOps: 0,
        wrBytes: 0,
      },
      quotaBytes: 20 * 2 ** 30,
    });
    const s = poolStrata(p, { total: 257698037760, usedRaw: 30081232896, nearFullRatio: 0.85, fullRatio: 0.95 })!;
    expect(s.stored).toBe(9145945383);
    expect(s.overhead).toBe(27437980533 - 9145945383);
    expect(s.free).toBe(70895935488 * 3);
    expect(s.total).toBe(27437980533 + 70895935488 * 3);
    expect(s.quotaAt).toBe(60 * 2 ** 30);
    expect(s.nearFullAt).toBeCloseTo(s.total - 0.1 * 257698037760, 0);
    expect(poolStrata(pool(), { total: 1, usedRaw: 0, nearFullRatio: 0.85, fullRatio: 0.95 })).toBeNull();
  });
});
