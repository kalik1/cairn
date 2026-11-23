import {
  buildSnapshotClass,
  buildStorageClass,
  cephKindOf,
  classConsequences,
  classRows,
  classUsage,
  defaultForm,
  detectDriver,
  freeName,
  fsDataPools,
  nameProblem,
  parseQuantity,
  presetAvailability,
  secretParams,
  snapshotRows,
  validateClassForm,
  WizardContext,
} from './storageclass';
import { Obj } from './types';

// A class for VM disks on Ceph RBD, and objects shaped like real ones.
export const SAMPLE_SC: Obj = {
  apiVersion: 'storage.k8s.io/v1',
  kind: 'StorageClass',
  metadata: { name: 'ceph-rbd', annotations: { description: 'Ceph RBD, 3 replicas across hosts (shared: VMs can live-migrate)' } },
  provisioner: 'rook-ceph.rbd.csi.ceph.com',
  parameters: {
    clusterID: 'rook-ceph',
    pool: 'vm-pool',
    imageFormat: '2',
    imageFeatures: 'layering,deep-flatten,exclusive-lock,object-map,fast-diff',
    mounter: 'rbd',
    mapOptions: 'krbd:rxbounce',
    'csi.storage.k8s.io/provisioner-secret-name': 'rook-csi-rbd-provisioner',
    'csi.storage.k8s.io/provisioner-secret-namespace': 'rook-ceph',
    'csi.storage.k8s.io/controller-expand-secret-name': 'rook-csi-rbd-provisioner',
    'csi.storage.k8s.io/controller-expand-secret-namespace': 'rook-ceph',
    'csi.storage.k8s.io/controller-publish-secret-name': 'rook-csi-rbd-provisioner',
    'csi.storage.k8s.io/controller-publish-secret-namespace': 'rook-ceph',
    'csi.storage.k8s.io/node-stage-secret-name': 'rook-csi-rbd-node',
    'csi.storage.k8s.io/node-stage-secret-namespace': 'rook-ceph',
    'csi.storage.k8s.io/fstype': 'ext4',
  },
  allowVolumeExpansion: true,
  reclaimPolicy: 'Delete',
  volumeBindingMode: 'Immediate',
};

export const TOPOLVM_SC: Obj = {
  kind: 'StorageClass',
  metadata: { name: 'topolvm-provisioner', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
  provisioner: 'topolvm.io',
  reclaimPolicy: 'Delete',
};

export const SAMPLE_VSC: Obj = {
  kind: 'VolumeSnapshotClass',
  metadata: { name: 'ceph-rbd-snapshot' },
  driver: 'rook-ceph.rbd.csi.ceph.com',
  parameters: { clusterID: 'rook-ceph', 'csi.storage.k8s.io/snapshotter-secret-name': 'rook-csi-rbd-provisioner' },
  deletionPolicy: 'Delete',
};

export const pv = (name: string, sc: string, size: string, mode = 'Block', claim?: [string, string]): Obj => ({
  kind: 'PersistentVolume',
  metadata: { name },
  spec: {
    storageClassName: sc,
    capacity: { storage: size },
    volumeMode: mode,
    accessModes: ['ReadWriteMany'],
    claimRef: claim ? { namespace: claim[0], name: claim[1] } : undefined,
    csi: sc === 'ceph-rbd' ? { driver: 'rook-ceph.rbd.csi.ceph.com', volumeAttributes: { pool: 'vm-pool', imageName: `csi-vol-${name}`, clusterID: 'rook-ceph' } } : undefined,
  },
  status: { phase: 'Bound' },
});

const ctx = (over: Partial<WizardContext> = {}): WizardContext => ({
  ns: 'rook-ceph',
  storageClasses: [SAMPLE_SC, TOPOLVM_SC],
  snapshotClasses: [SAMPLE_VSC],
  drivers: [{ metadata: { name: 'rook-ceph.rbd.csi.ceph.com', namespace: 'rook-ceph' } }],
  filesystems: [],
  blockPools: [{ metadata: { name: 'vm-pool', namespace: 'rook-ceph' } }, { metadata: { name: 'test-k8s-pool', namespace: 'rook-ceph' } }],
  ...over,
});

describe('kinds and quantities', () => {
  it('recognises Ceph provisioners', () => {
    expect(cephKindOf('rook-ceph.rbd.csi.ceph.com')).toBe('rbd');
    expect(cephKindOf('rbd.csi.ceph.com')).toBe('rbd');
    expect(cephKindOf('openshift-storage.cephfs.csi.ceph.com')).toBe('cephfs');
    expect(cephKindOf('rook-ceph.nfs.csi.ceph.com')).toBe('nfs');
    expect(cephKindOf('rook-ceph.ceph.rook.io/bucket')).toBe('bucket');
    expect(cephKindOf('topolvm.io')).toBeNull();
    expect(cephKindOf('fake-rbd.csi.ceph.com.evil')).toBeNull();
    expect(cephKindOf(undefined)).toBeNull();
  });

  it('parses Kubernetes quantities', () => {
    expect(parseQuantity('10Gi')).toBe(10 * 2 ** 30);
    expect(parseQuantity('1G')).toBe(1e9);
    expect(parseQuantity('1.5Ti')).toBe(1.5 * 2 ** 40);
    expect(parseQuantity('500M')).toBe(5e8);
    expect(parseQuantity('2e3')).toBe(2000);
    expect(parseQuantity('12345')).toBe(12345);
    expect(parseQuantity('junk')).toBe(0);
    expect(parseQuantity(undefined)).toBe(0);
  });
});

describe('class rows', () => {
  const pvs = [pv('a', 'ceph-rbd', '10Gi'), pv('b', 'ceph-rbd', '30Gi'), pv('c', 'topolvm-provisioner', '1Gi', 'Filesystem')];
  it('describes Ceph classes in plain words and keeps the others apart', () => {
    const { rows, others } = classRows([SAMPLE_SC, TOPOLVM_SC], pvs, [SAMPLE_VSC]);
    expect(others.map(o => o.metadata.name)).toEqual(['topolvm-provisioner']);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({
      name: 'ceph-rbd',
      kind: 'rbd',
      words: 'Block volumes (RBD)',
      pool: 'vm-pool',
      clusterID: 'rook-ceph',
      fstype: 'ext4',
      reclaim: 'Delete',
      binding: 'Immediate',
      expansion: true,
      isDefault: false,
      pvCount: 2,
      capacity: 40 * 2 ** 30,
      snapshotClasses: ['ceph-rbd-snapshot'],
    });
    expect(r.imageFeatures).toContain('fast-diff');
  });

  it('says filesystem volumes on RBD when the volumes are filesystems, and unknown when there are none', () => {
    const fs = classRows([SAMPLE_SC], [pv('x', 'ceph-rbd', '1Gi', 'Filesystem')], []).rows[0];
    expect(fs.words).toBe('Filesystem volumes on RBD');
    const none = classRows([SAMPLE_SC], [], []).rows[0];
    expect(none.words).toBe('Block or filesystem volumes (RBD)');
    const preset = classRows([{ ...SAMPLE_SC, metadata: { name: 'v', annotations: { 'cairn.magesgate.com/preset': 'vm' } } }], [], []).rows[0];
    expect(preset.words).toMatch(/VM disks/);
  });

  it('lists snapshot classes with the classes they serve', () => {
    const rows = snapshotRows([SAMPLE_VSC, { metadata: { name: 'topolvm-snapshot' }, driver: 'topolvm.io' }], [SAMPLE_SC, TOPOLVM_SC]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'ceph-rbd-snapshot', kind: 'rbd', deletionPolicy: 'Delete', isDefault: false, serves: ['ceph-rbd'] });
  });

  it('counts what still uses a class', () => {
    const pending: Obj = { metadata: { name: 'p', namespace: 'x' }, spec: { storageClassName: 'ceph-rbd' }, status: { phase: 'Pending' } };
    const u = classUsage('ceph-rbd', pvs, [pending]);
    expect(u.pvs.map(p => p.metadata.name)).toEqual(['a', 'b']);
    expect(u.pending).toHaveLength(1);
    expect(classUsage('nothing', pvs, []).pvs).toHaveLength(0);
  });
});

describe('wizard', () => {
  it('finds the driver: Driver CR first, then classes, then a guess', () => {
    expect(detectDriver(ctx(), 'rbd')).toEqual({ provisioner: 'rook-ceph.rbd.csi.ceph.com', source: 'driver', deployed: true });
    expect(detectDriver(ctx({ drivers: [] }), 'rbd')).toMatchObject({ source: 'class', deployed: false });
    expect(detectDriver(ctx({ drivers: [], storageClasses: [] }), 'cephfs')).toEqual({
      provisioner: 'rook-ceph.cephfs.csi.ceph.com',
      source: 'guess',
      deployed: false,
    });
  });

  it('learns clusterID and secret names from the existing class', () => {
    const f = defaultForm(ctx(), 'vm', { pool: 'test-k8s-pool' });
    expect(f).toMatchObject({
      preset: 'vm',
      name: 'test-k8s-pool-vm',
      provisioner: 'rook-ceph.rbd.csi.ceph.com',
      clusterID: 'rook-ceph',
      pool: 'test-k8s-pool',
      imageFeatures: 'layering,deep-flatten,exclusive-lock,object-map,fast-diff',
      mapOptions: 'krbd:rxbounce',
      learnedFrom: 'ceph-rbd',
    });
    expect(f.secrets).toEqual(secretParams(SAMPLE_SC));
    expect(f.secrets['csi.storage.k8s.io/node-stage-secret-name']).toBe('rook-csi-rbd-node');
    // A snapshot class for this driver exists: not proposed by default.
    expect(f.snapshot.create).toBe(false);
  });

  it("uses Rook's secret names when no class exists", () => {
    const f = defaultForm(ctx({ storageClasses: [], snapshotClasses: [] }), 'fs');
    expect(f.secrets['csi.storage.k8s.io/provisioner-secret-name']).toBe('rook-csi-rbd-provisioner');
    expect(f.secrets['csi.storage.k8s.io/node-stage-secret-namespace']).toBe('rook-ceph');
    expect(f.snapshot.create).toBe(true);
    expect(f.bindingMode).toBe('WaitForFirstConsumer');
  });

  it('builds the VM disk class and its snapshot class', () => {
    const f = { ...defaultForm(ctx(), 'vm', { pool: 'test-k8s-pool' }), name: 'test-rbd-vm' };
    f.snapshot = { ...f.snapshot, create: true, name: 'test-rbd-snap' };
    const sc = buildStorageClass(f);
    expect(sc).toMatchObject({
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: { name: 'test-rbd-vm', annotations: { 'cairn.magesgate.com/preset': 'vm' } },
      provisioner: 'rook-ceph.rbd.csi.ceph.com',
      reclaimPolicy: 'Delete',
      volumeBindingMode: 'Immediate',
      allowVolumeExpansion: true,
    });
    expect(sc.parameters).toMatchObject({
      clusterID: 'rook-ceph',
      pool: 'test-k8s-pool',
      imageFormat: '2',
      imageFeatures: 'layering,deep-flatten,exclusive-lock,object-map,fast-diff',
      mapOptions: 'krbd:rxbounce',
      'csi.storage.k8s.io/provisioner-secret-name': 'rook-csi-rbd-provisioner',
      'csi.storage.k8s.io/fstype': 'ext4',
    });
    expect(sc.metadata.annotations?.['storageclass.kubernetes.io/is-default-class']).toBeUndefined();
    const vsc = buildSnapshotClass(f)!;
    expect(vsc).toEqual({
      apiVersion: 'snapshot.storage.k8s.io/v1',
      kind: 'VolumeSnapshotClass',
      metadata: { name: 'test-rbd-snap' },
      driver: 'rook-ceph.rbd.csi.ceph.com',
      parameters: {
        clusterID: 'rook-ceph',
        'csi.storage.k8s.io/snapshotter-secret-name': 'rook-csi-rbd-provisioner',
        'csi.storage.k8s.io/snapshotter-secret-namespace': 'rook-ceph',
      },
      deletionPolicy: 'Delete',
    });
    expect(validateClassForm(f, ctx())).toEqual({});
  });

  it('builds a CephFS class with fsName and the cephfs secrets', () => {
    const fsCtx = ctx({
      filesystems: [{ metadata: { name: 'myfs' }, spec: { dataPools: [{ name: 'replicated' }, {}] } }],
      drivers: [{ metadata: { name: 'rook-ceph.cephfs.csi.ceph.com' } }],
      storageClasses: [],
    });
    expect(presetAvailability(fsCtx, 'shared').ok).toBe(true);
    const f = defaultForm(fsCtx, 'shared');
    expect(f.provisioner).toBe('rook-ceph.cephfs.csi.ceph.com');
    const sc = buildStorageClass({ ...f, pool: 'myfs-replicated' });
    expect(sc.parameters).toMatchObject({ fsName: 'myfs', pool: 'myfs-replicated', 'csi.storage.k8s.io/node-stage-secret-name': 'rook-csi-cephfs-node' });
    expect(sc.parameters.imageFeatures).toBeUndefined();
    expect(fsDataPools(fsCtx.filesystems[0])).toEqual(['myfs-replicated', 'myfs-data1']);
  });

  it('explains why the shared filesystem preset is not available', () => {
    expect(presetAvailability(ctx(), 'shared')).toMatchObject({ ok: false, reason: expect.stringMatching(/no CephFilesystem/) });
    const r = presetAvailability(ctx({ filesystems: [{ metadata: { name: 'myfs' } }] }), 'shared');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/CephFS CSI driver is not deployed/);
    expect(presetAvailability(ctx({ blockPools: [] }), 'vm').ok).toBe(false);
  });

  it('validates names, features and duplicates', () => {
    expect(nameProblem('Test')).toMatch(/Lowercase/);
    expect(nameProblem('')).toMatch(/name/);
    expect(nameProblem('test-rbd-vm')).toBeNull();
    const base = defaultForm(ctx(), 'vm', { pool: 'test-k8s-pool' });
    expect(validateClassForm({ ...base, name: 'ceph-rbd' }, ctx()).name).toMatch(/exists already/);
    expect(validateClassForm({ ...base, imageFeatures: 'layering,bogus' }, ctx()).imageFeatures).toMatch(/Unknown/);
    expect(validateClassForm({ ...base, imageFeatures: 'layering,object-map' }, ctx()).imageFeatures).toMatch(/exclusive-lock/);
    expect(validateClassForm({ ...base, imageFeatures: 'exclusive-lock' }, ctx()).imageFeatures).toMatch(/layering/);
    expect(validateClassForm({ ...base, pool: '' }, ctx()).pool).toBeTruthy();
    expect(validateClassForm({ ...base, provisioner: 'rook-ceph.cephfs.csi.ceph.com' }, ctx()).provisioner).toBeTruthy();
    const dupSnap = { ...base, snapshot: { ...base.snapshot, create: true, name: 'ceph-rbd-snapshot' } };
    expect(validateClassForm(dupSnap, ctx()).snapshotName).toMatch(/exists already/);
  });

  it('warns about a second default class', () => {
    const f = { ...defaultForm(ctx(), 'vm'), makeDefault: true };
    const c = classConsequences(f, ctx());
    expect(c.join('\n')).toMatch(/next to topolvm-provisioner/);
    expect(buildStorageClass(f).metadata.annotations?.['storageclass.kubernetes.io/is-default-class']).toBe('true');
  });

  it('picks free names', () => {
    expect(freeName('Vm Pool_x', [])).toBe('vm-pool-x');
    expect(freeName('a', ['a', 'a-2'])).toBe('a-3');
  });
});
