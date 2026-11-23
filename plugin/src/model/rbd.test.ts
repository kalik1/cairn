import {
  bindingOf,
  bindingsFor,
  childrenOf,
  cloneNeedsProtect,
  decodeFeatures,
  decodeFlags,
  decodeOpFeatures,
  featureProblems,
  imageRules,
  imageSpec,
  isCsiName,
  nameProblem,
  parseRbdDu,
  parseRbdImages,
  RbdImage,
  snapNameNow,
  snapSpec,
  toggleFeature,
  trashDeferred,
  volumeSnapshotFor,
} from './rbd';
import { Obj } from './types';

// A real answer for one vm-pool image (bridge rbd_images, watchers on).
const SAMPLE_IMAGES = {
  images: [
    {
      name: 'csi-vol-00000000-0000-4000-8000-000000000006',
      id: '68fd49e1b69d',
      size: 1073741824,
      obj_size: 4194304,
      num_objs: 256,
      order: 22,
      prefix: 'rbd_data.68fd49e1b69d',
      features: 61,
      flags: 0,
      op_features: 0,
      created: '2026-11-23T02:48:30+00:00',
      modified: '2026-11-23T02:48:30+00:00',
      data_pool_id: 1,
      snaps: [],
      children: [],
      watchers: [{ addr: '192.0.2.216:0/1014', id: 4427 }],
    },
    { name: 'gone', error: '[errno 2] RBD image not found' },
  ],
  trash: [{ id: '1234abcd', name: 'old', source: 'USER', deleted: '2026-11-23T03:00:00', deferred_until: '2026-11-23T03:00:00' }],
  namespaces: [],
};

const SAMPLE_DU = {
  images: [
    { name: 'csi-vol-00000000-0000-4000-8000-000000000003', id: '1139eb7ed850', provisioned_size: 32212254720, used_size: 7021264896 },
    { name: 'test-img', snapshot: 'snap1', provisioned_size: 1073741824, used_size: 4194304 },
    { name: 'test-img', provisioned_size: 1073741824, used_size: 8388608 },
  ],
  total_provisioned_size: 33285996544,
  total_used_size: 7033847808,
};

describe('parsing', () => {
  it('reads rbd_images', () => {
    const r = parseRbdImages(SAMPLE_IMAGES);
    expect(r.images).toHaveLength(2);
    const i = r.images[0];
    expect(i).toMatchObject({ size: 1073741824, numObjs: 256, features: 61, dataPoolId: 1, snaps: [], children: [] });
    expect(i.created).toBe(Date.parse('2026-11-23T02:48:30Z'));
    expect(i.watchers).toEqual([{ addr: '192.0.2.216:0/1014', id: 4427 }]);
    expect(r.images[1].error).toContain('not found');
    expect(r.trash[0]).toMatchObject({ id: '1234abcd', name: 'old', source: 'USER' });
    expect(r.namespaces).toEqual([]);
    expect(parseRbdImages(null)).toEqual({ images: [], trash: [], namespaces: null });
  });

  it('reads rbd du without counting snapshots as images', () => {
    const d = parseRbdDu(SAMPLE_DU);
    expect(d.byImage.get('test-img')).toEqual({ provisioned: 1073741824, used: 8388608 });
    expect(d.bySnap.get('test-img@snap1')).toBe(4194304);
    expect(d.byImage.get('csi-vol-00000000-0000-4000-8000-000000000003')?.used).toBe(7021264896);
    expect(d.used).toBe(7033847808);
  });
});

describe('features', () => {
  it('decodes the usual default (61)', () => {
    expect(decodeFeatures(61).map(f => f.name)).toEqual(['layering', 'exclusive-lock', 'object-map', 'fast-diff', 'deep-flatten']);
    expect(decodeFeatures(64 | 4096).map(f => f.name)).toEqual(['journaling', 'bit 4096']);
    expect(decodeFlags(3)).toEqual(['object-map-invalid', 'fast-diff-invalid']);
    expect(decodeOpFeatures(3)).toEqual(['clone-parent', 'clone-child']);
  });

  it('keeps feature dependencies whole', () => {
    expect(featureProblems(['layering', 'fast-diff'])).toEqual(['fast-diff needs object-map.']);
    expect(toggleFeature(['layering'], 'fast-diff', true)).toEqual(['layering', 'exclusive-lock', 'object-map', 'fast-diff']);
    expect(toggleFeature(['layering', 'exclusive-lock', 'object-map', 'fast-diff', 'journaling'], 'exclusive-lock', false)).toEqual(['layering']);
  });
});

describe('names', () => {
  it('builds rbd specs with and without namespaces', () => {
    expect(imageSpec('test-pool', '', 'test-img')).toBe('test-pool/test-img');
    expect(imageSpec('test-pool', 'ns1', 'test-img')).toBe('test-pool/ns1/test-img');
    expect(snapSpec('test-pool', undefined, 'test-img', 's1')).toBe('test-pool/test-img@s1');
  });

  it('checks names', () => {
    expect(nameProblem('', [])).toContain('Give');
    expect(nameProblem('a/b', [])).toContain('Use letters');
    expect(nameProblem('test-img', ['test-img'])).toContain('already exists');
    expect(nameProblem('test-img', [])).toBeNull();
    expect(isCsiName('csi-vol-00000000-0000-4000-8000-000000000006')).toBe(true);
    expect(isCsiName('csi-vol-mine')).toBe(false);
    expect(snapNameNow(new Date(2026, 10, 23, 4, 5))).toBe('snap-2026-11-23-0405');
  });
});

/* ----------------------------------------------------- bindings */

const PV: Obj = {
  kind: 'PersistentVolume',
  metadata: { name: 'pvc-d44af61b' },
  spec: {
    claimRef: { namespace: 'demo', name: 'restore-rootdisk-ceph' },
    csi: {
      driver: 'rook-ceph.rbd.csi.ceph.com',
      volumeAttributes: { clusterID: 'rook-ceph', pool: 'vm-pool', imageName: 'csi-vol-00000000-0000-4000-8000-000000000006' },
    },
  },
};
const PVC: Obj = { kind: 'PersistentVolumeClaim', metadata: { name: 'restore-rootdisk-ceph', namespace: 'demo' }, spec: {} };
const pod = (name: string, claim: string, labels: Record<string, string> = {}, phase = 'Running'): Obj => ({
  kind: 'Pod',
  metadata: { name, namespace: 'demo', labels },
  spec: { volumes: [{ name: 'd', persistentVolumeClaim: { claimName: claim } }] },
  status: { phase },
});
const LAUNCHER = pod('virt-launcher-cirros-test-7tts4', 'restore-rootdisk-ceph', { 'kubevirt.io': 'virt-launcher', 'vm.kubevirt.io/name': 'cirros-test' });
const DONE = pod('virt-launcher-cirros-test-old', 'restore-rootdisk-ceph', { 'vm.kubevirt.io/name': 'cirros-test' }, 'Succeeded');
const VM: Obj = {
  kind: 'VirtualMachine',
  metadata: { name: 'stopped-vm', namespace: 'demo' },
  spec: { template: { spec: { volumes: [{ name: 'root', dataVolume: { name: 'restore-rootdisk-ceph' } }] } } },
};

describe('Kubernetes binding', () => {
  it('maps image → PV → PVC → pod → VM', () => {
    const m = bindingsFor('vm-pool', '', { pvs: [PV], pvcs: [PVC], pods: [LAUNCHER, DONE], vms: [VM] });
    const b = bindingOf(m, 'csi-vol-00000000-0000-4000-8000-000000000006');
    expect(b.pv?.metadata.name).toBe('pvc-d44af61b');
    expect(b.pvc?.metadata.name).toBe('restore-rootdisk-ceph');
    expect(b.pods.map(p => p.metadata.name)).toEqual(['virt-launcher-cirros-test-7tts4']);
    expect(b.vms).toEqual([
      { namespace: 'demo', name: 'cirros-test', running: true },
      { namespace: 'demo', name: 'stopped-vm', running: false },
    ]);
    expect(b.csi).toBe(true);
  });

  it('ignores other pools, namespaces and drivers', () => {
    expect(bindingsFor('other', '', { pvs: [PV], pvcs: [], pods: [] }).size).toBe(0);
    expect(bindingsFor('vm-pool', 'ns1', { pvs: [PV], pvcs: [], pods: [] }).size).toBe(0);
    const lvm = { ...PV, spec: { ...PV.spec, csi: { ...PV.spec.csi, driver: 'topolvm.io' } } };
    expect(bindingsFor('vm-pool', '', { pvs: [lvm], pvcs: [], pods: [] }).size).toBe(0);
    const free = bindingOf(new Map(), 'test-img');
    expect(free).toEqual({ pods: [], vms: [], csi: false });
  });
});

/* -------------------------------------------------------- safety */

const img = (over: Partial<RbdImage> = {}): RbdImage => ({
  name: 'test-img',
  id: 'abc',
  size: 2 ** 30,
  objSize: 4194304,
  numObjs: 256,
  order: 22,
  prefix: 'rbd_data.abc',
  features: 61,
  flags: 0,
  opFeatures: 0,
  created: null,
  modified: null,
  dataPoolId: null,
  snaps: [{ id: 4, name: 's1', size: 2 ** 30, protected: false, time: null, nsType: 0 }],
  children: [],
  watchers: [],
  ...over,
});
const where = { pool: 'test-pool', ns: '' };
const free = { pods: [], vms: [], csi: false };

describe('safety rules', () => {
  it('allows everything on an idle test image', () => {
    const r = imageRules(img(), free, { cloneNeedsProtect: true, ...where });
    const s = img().snaps[0];
    expect(r.snapshot.ok).toBe(true);
    expect(r.resize.ok).toBe(true);
    expect(r.trash.ok).toBe(true);
    expect(r.rollback(s)).toMatchObject({ ok: true, reason: expect.stringContaining('is lost') });
    expect(r.removeSnap(s).ok).toBe(true);
    expect(r.protect(s).ok).toBe(true);
    expect(r.unprotect(s).ok).toBe(false);
    expect(r.clone(s)).toMatchObject({ ok: false, reason: expect.stringContaining('Protect the snapshot first') });
    expect(imageRules(img(), free, { cloneNeedsProtect: false, ...where }).clone(s).ok).toBe(true);
    expect(r.flatten.ok).toBe(false);
  });

  it('never rolls back an image in use', () => {
    const busy = img({ watchers: [{ addr: '192.0.2.216:0/1', id: 1 }] });
    const r = imageRules(busy, free, { cloneNeedsProtect: true, ...where });
    expect(r.rollback(busy.snaps[0])).toMatchObject({ ok: false, reason: expect.stringContaining('in use by 1 client') });
    expect(r.trash.ok).toBe(false);
    expect(r.snapshot).toMatchObject({ ok: true, reason: expect.stringContaining('crash-consistent') });
  });

  it('steers CSI images to Kubernetes', () => {
    const m = bindingsFor('vm-pool', '', { pvs: [PV], pvcs: [PVC], pods: [LAUNCHER] });
    const name = 'csi-vol-00000000-0000-4000-8000-000000000006';
    const b = bindingOf(m, name);
    const i = img({ name, watchers: [{ addr: 'x', id: 1 }] });
    const r = imageRules(i, b, { cloneNeedsProtect: true, pool: 'vm-pool', ns: '' });
    expect(r.snapshot).toMatchObject({ ok: false, reason: expect.stringContaining('VolumeSnapshot') });
    expect(r.volumeSnapshot.ok).toBe(true);
    expect(r.rollback(i.snaps[0]).ok).toBe(false);
    expect(r.resize.reason).toContain('claim');
    expect(r.trash.reason).toContain('demo/restore-rootdisk-ceph');
    // Even without a PV, a csi-vol- name is left to the driver.
    expect(imageRules(i, bindingOf(new Map(), name), { cloneNeedsProtect: true, ...where }).snapshot.ok).toBe(false);
  });

  it('guards protected snapshots and snapshots with clones', () => {
    const prot = { id: 4, name: 's1', size: 1, protected: true, time: null, nsType: 0 };
    const parent = img({ snaps: [prot, { ...prot, id: 5, name: 's2', protected: true }], children: [{ pool: 'test-pool', ns: '', image: 'test-clone' }] });
    const clone = img({ name: 'test-clone', parent: { pool: 'test-pool', ns: '', image: 'test-img', snap: 's1' } });
    const r = imageRules(parent, free, { cloneNeedsProtect: true, ...where, others: [clone] });
    expect(r.removeSnap(prot).reason).toContain('unprotect it first');
    expect(r.unprotect(prot)).toMatchObject({ ok: false, reason: expect.stringContaining('test-clone') });
    // s2 has no clone once we know test-clone came from s1.
    expect(r.unprotect(parent.snaps[1]).ok).toBe(true);
    // Without that knowledge every snapshot counts as a parent.
    expect(imageRules(parent, free, { cloneNeedsProtect: true, ...where }).unprotect(parent.snaps[1]).ok).toBe(false);
    expect(childrenOf(parent, 's1', where, [clone]).map(c => c.image)).toEqual(['test-clone']);
    expect(imageRules(clone, free, { cloneNeedsProtect: true, ...where }).flatten.ok).toBe(true);
    const sys = { ...prot, nsType: 2, protected: false };
    expect(r.rollback(sys).ok).toBe(false);
  });

  it('knows when clones need protected snapshots', () => {
    expect(cloneNeedsProtect('luminous')).toBe(true);
    expect(cloneNeedsProtect('mimic')).toBe(false);
    expect(cloneNeedsProtect('reef')).toBe(false);
    expect(cloneNeedsProtect('reef', '1')).toBe(true);
    expect(cloneNeedsProtect('')).toBe(true);
  });
});

describe('VolumeSnapshot and trash', () => {
  it('builds a VolumeSnapshot of the claim', () => {
    expect(volumeSnapshotFor(PVC, 'ceph-rbd-snapshot', 'restore-snap-1')).toEqual({
      apiVersion: 'snapshot.storage.k8s.io/v1',
      kind: 'VolumeSnapshot',
      metadata: { name: 'restore-snap-1', namespace: 'demo' },
      spec: { volumeSnapshotClassName: 'ceph-rbd-snapshot', source: { persistentVolumeClaimName: 'restore-rootdisk-ceph' } },
    });
  });

  it('knows deferred trash entries', () => {
    const t = parseRbdImages({ trash: [{ id: 'x', name: 'n', source: 0, deleted: null, deferred_until: '2026-11-23T05:00:00+0000' }] }).trash[0];
    expect(t.source).toBe('USER');
    expect(trashDeferred(t, Date.parse('2026-11-23T04:00:00Z'))).toBe(true);
    expect(trashDeferred(t, Date.parse('2026-11-23T06:00:00Z'))).toBe(false);
  });
});
