import { cephVolumes, consumersByClaim, filterVolumes, shortMode, statusTone, volumeTotals } from './cephvolumes';
import { Obj } from './types';

const SC: Obj = { metadata: { name: 'ceph-rbd' }, provisioner: 'rook-ceph.rbd.csi.ceph.com' };
const FS_SC: Obj = { metadata: { name: 'cephfs' }, provisioner: 'rook-ceph.cephfs.csi.ceph.com' };
const LOCAL: Obj = { metadata: { name: 'topolvm-provisioner' }, provisioner: 'topolvm.io' };

// Shaped like a real PV pvc-40b369ab-… (demo/gpu-vm-3-rootdisk).
const rbdPv: Obj = {
  metadata: { name: 'pvc-40b3' },
  spec: {
    accessModes: ['ReadWriteMany'],
    capacity: { storage: '10Gi' },
    claimRef: { name: 'gpu-vm-3-rootdisk', namespace: 'demo', uid: 'u1' },
    csi: {
      driver: 'rook-ceph.rbd.csi.ceph.com',
      volumeAttributes: { clusterID: 'rook-ceph', imageName: 'csi-vol-aeb0ebc5', pool: 'vm-pool', journalPool: 'vm-pool' },
    },
    storageClassName: 'ceph-rbd',
    volumeMode: 'Block',
  },
  status: { phase: 'Bound' },
};
const fsPv: Obj = {
  metadata: { name: 'pvc-fs1' },
  spec: {
    accessModes: ['ReadWriteMany'],
    capacity: { storage: '5Gi' },
    claimRef: { name: 'shared', namespace: 'apps' },
    csi: { driver: 'rook-ceph.cephfs.csi.ceph.com', volumeAttributes: { fsName: 'myfs', subvolumeName: 'csi-vol-1', subvolumePath: '/volumes/csi/csi-vol-1/x' } },
    storageClassName: 'cephfs',
  },
  status: { phase: 'Bound' },
};
const localPv: Obj = { metadata: { name: 'pvc-local' }, spec: { storageClassName: 'topolvm-provisioner', csi: { driver: 'topolvm.io' } }, status: { phase: 'Bound' } };
const claim = (ns: string, name: string, sc: string, extra: any = {}): Obj => ({
  metadata: { namespace: ns, name, uid: extra.uid },
  spec: { storageClassName: sc, accessModes: ['ReadWriteMany'], resources: { requests: { storage: '1Gi' } }, volumeMode: 'Block', ...extra.spec },
  status: { phase: extra.phase ?? 'Bound' },
});
const launcher: Obj = {
  metadata: { namespace: 'demo', name: 'virt-launcher-gpu-vm-3-abcde', labels: { 'kubevirt.io': 'virt-launcher', 'vm.kubevirt.io/name': 'gpu-vm-3' } },
  spec: { nodeName: 'kube-node-2', volumes: [{ name: 'rootdisk', persistentVolumeClaim: { claimName: 'gpu-vm-3-rootdisk' } }] },
  status: { phase: 'Running' },
};
const app: Obj = {
  metadata: { namespace: 'apps', name: 'web-1' },
  spec: { nodeName: 'n2', volumes: [{ name: 'd', persistentVolumeClaim: { claimName: 'shared' } }, { name: 'cfg', configMap: { name: 'x' } }] },
  status: { phase: 'Running' },
};
const done: Obj = { metadata: { namespace: 'apps', name: 'job-1' }, spec: { volumes: [{ persistentVolumeClaim: { claimName: 'shared' } }] }, status: { phase: 'Succeeded' } };

describe('Ceph volumes', () => {
  const pvcs = [claim('demo', 'gpu-vm-3-rootdisk', 'ceph-rbd', { uid: 'u1' }), claim('apps', 'shared', 'cephfs'), claim('test-cairn', 'test-pvc', 'ceph-rbd', { phase: 'Pending' })];
  const rows = cephVolumes([rbdPv, fsPv, localPv], pvcs, [SC, FS_SC, LOCAL], [launcher, app, done]);

  it('keeps Ceph PVs and pending claims of Ceph classes only', () => {
    expect(rows.map(r => r.key)).toEqual(['pv/pvc-fs1', 'pv/pvc-40b3', 'pvc/test-cairn/test-pvc']);
  });

  it('reads the pool and image of an RBD volume, and its VM', () => {
    const r = rows.find(x => x.pvName === 'pvc-40b3')!;
    expect(r).toMatchObject({ kind: 'rbd', pool: 'vm-pool', image: 'csi-vol-aeb0ebc5', claimNs: 'demo', claimName: 'gpu-vm-3-rootdisk', volumeMode: 'Block', status: 'Bound', sizeBytes: 10 * 2 ** 30 });
    expect(r.pvc?.metadata.name).toBe('gpu-vm-3-rootdisk');
    expect(r.consumers).toEqual([{ pod: 'virt-launcher-gpu-vm-3-abcde', namespace: 'demo', vm: 'gpu-vm-3', node: 'kube-node-2', phase: 'Running' }]);
  });

  it('reads the CephFS subvolume and skips finished pods', () => {
    const r = rows.find(x => x.pvName === 'pvc-fs1')!;
    expect(r).toMatchObject({ kind: 'cephfs', fsName: 'myfs', subvolume: 'csi-vol-1', volumeMode: 'Filesystem' });
    expect(r.consumers.map(c => c.pod)).toEqual(['web-1']);
  });

  it('shows a pending claim with its requested size', () => {
    const r = rows.find(x => x.key === 'pvc/test-cairn/test-pvc')!;
    expect(r).toMatchObject({ status: 'Pending', sizeBytes: 2 ** 30, storageClass: 'ceph-rbd' });
  });

  it('does not tie a PV to a newer claim with the same name', () => {
    const r = cephVolumes([rbdPv], [claim('demo', 'gpu-vm-3-rootdisk', 'ceph-rbd', { uid: 'other' })], [SC], [launcher]);
    expect(r[0].pvc).toBeUndefined();
    expect(r[0].consumers).toEqual([]);
  });

  it('filters by words, class, status and use', () => {
    expect(filterVolumes(rows, { q: 'gpu-vm-3' }).map(r => r.pvName)).toEqual(['pvc-40b3']);
    expect(filterVolumes(rows, { q: 'vm-pool csi-vol-aeb' })).toHaveLength(1);
    expect(filterVolumes(rows, { storageClass: 'cephfs' })).toHaveLength(1);
    expect(filterVolumes(rows, { status: 'Pending' })).toHaveLength(1);
    expect(filterVolumes(rows, { use: 'vm' }).map(r => r.pvName)).toEqual(['pvc-40b3']);
    expect(filterVolumes(rows, { use: 'pod' }).map(r => r.pvName)).toEqual(['pvc-fs1']);
    expect(filterVolumes(rows, { use: 'idle' }).map(r => r.key)).toEqual(['pvc/test-cairn/test-pvc']);
  });

  it('sums the totals', () => {
    expect(volumeTotals(rows)).toEqual({ count: 3, bytes: 10 * 2 ** 30 + 5 * 2 ** 30 + 2 ** 30, vms: 1, idle: 0, notBound: 1 });
  });

  it('maps consumers and words', () => {
    expect(consumersByClaim([launcher]).get('demo/gpu-vm-3-rootdisk')?.[0].vm).toBe('gpu-vm-3');
    expect(shortMode('ReadWriteMany')).toBe('RWX');
    expect(shortMode('ReadWriteOncePod')).toBe('RWOP');
    expect(statusTone('Bound')).toBe('ok');
    expect(statusTone('Released')).toBe('warn');
    expect(statusTone('Lost')).toBe('err');
  });
});
