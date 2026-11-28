import { csiDrivers, csiOperator, driverImageSet, driverWorkloads, imagesOf, nodeCoverage, podHealth, rollout, versionOf } from './csi';
import { Obj } from './types';

const DRIVER = 'rook-ceph.rbd.csi.ceph.com';
const driverCr: Obj = { kind: 'Driver', metadata: { name: DRIVER, namespace: 'rook-ceph' }, spec: { attachRequired: true } };
const ctrl: Obj = {
  kind: 'Deployment',
  metadata: { name: `${DRIVER}-ctrlplugin`, namespace: 'rook-ceph' },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: `${DRIVER}-ctrlplugin` } },
    template: {
      spec: {
        containers: [
          { name: 'csi-rbdplugin', image: 'quay.io/cephcsi/cephcsi:v3.18.1' },
          { name: 'csi-provisioner', image: 'registry.k8s.io/sig-storage/csi-provisioner:v6.3.0' },
        ],
      },
    },
  },
  status: { readyReplicas: 1, updatedReplicas: 1 },
};
const node: Obj = {
  kind: 'DaemonSet',
  metadata: { name: `${DRIVER}-nodeplugin`, namespace: 'rook-ceph' },
  spec: {
    selector: { matchLabels: { app: `${DRIVER}-nodeplugin` } },
    template: { spec: { containers: [{ name: 'csi-rbdplugin', image: 'quay.io/cephcsi/cephcsi:v3.18.1' }], tolerations: [{ key: 'storage', operator: 'Exists' }] } },
  },
  status: { desiredNumberScheduled: 3, numberReady: 2, updatedNumberScheduled: 3 },
};
const pod = (name: string, nodeName: string, ready: boolean, restarts = 0, app = `${DRIVER}-nodeplugin`): Obj => ({
  metadata: { name, namespace: 'rook-ceph', labels: { app } },
  spec: { nodeName, containers: [{ name: 'a' }, { name: 'b' }] },
  status: {
    phase: 'Running',
    containerStatuses: [
      { name: 'a', ready: true, restartCount: restarts },
      { name: 'b', ready, restartCount: 0, state: ready ? {} : { waiting: { reason: 'CrashLoopBackOff' } } },
    ],
  },
});
const n = (name: string, extra: any = {}): Obj => ({
  metadata: { name },
  spec: extra.spec ?? {},
  status: { conditions: [{ type: 'Ready', status: extra.ready === false ? 'False' : 'True' }] },
});

describe('CSI drivers', () => {
  it('merges Driver CRs, CSIDriver objects and class provisioners', () => {
    const d = csiDrivers(
      [driverCr],
      [{ metadata: { name: DRIVER } }, { metadata: { name: 'topolvm.io' } }, { metadata: { name: 'rook-ceph.cephfs.csi.ceph.com' } }],
      [{ metadata: { name: 'ceph-rbd' }, provisioner: DRIVER }, { metadata: { name: 'bucket' }, provisioner: 'rook-ceph.ceph.rook.io/bucket' }]
    );
    expect(d.map(x => [x.name, x.kind, !!x.cr, !!x.csiDriver, x.classes])).toEqual([
      [DRIVER, 'rbd', true, true, ['ceph-rbd']],
      ['rook-ceph.cephfs.csi.ceph.com', 'cephfs', false, true, []],
    ]);
  });

  it('finds the plugin workloads and their pods', () => {
    const pods = [pod('np-1', 'n1', true), pod('np-2', 'n2', false, 4), pod('cp-1', 'n1', true, 0, `${DRIVER}-ctrlplugin`), pod('other', 'n1', true, 0, 'x')];
    const w = driverWorkloads(csiDrivers([driverCr], [], [])[0], [ctrl], [node], pods);
    expect(w.ctrl?.metadata.name).toBe(`${DRIVER}-ctrlplugin`);
    expect(w.node?.metadata.name).toBe(`${DRIVER}-nodeplugin`);
    expect(w.nodePods.map(p => p.metadata.name)).toEqual(['np-1', 'np-2']);
    expect(w.ctrlPods.map(p => p.metadata.name)).toEqual(['cp-1']);
  });

  it('finds the older Rook CSI names', () => {
    const legacy: Obj = { ...node, metadata: { name: 'csi-rbdplugin', namespace: 'rook-ceph' } };
    const w = driverWorkloads({ name: DRIVER, kind: 'rbd', classes: [] }, [], [legacy], []);
    expect(w.node?.metadata.name).toBe('csi-rbdplugin');
  });

  it('says which nodes can mount and why the others cannot', () => {
    const nodes = [
      n('n1'),
      n('n2'),
      n('n3', { spec: { taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] } }),
      n('n4', { spec: { taints: [{ key: 'storage', value: 'x', effect: 'NoSchedule' }] } }),
      n('n5', { ready: false }),
    ];
    const csiNodes = [
      { metadata: { name: 'n1' }, spec: { drivers: [{ name: DRIVER }] } },
      { metadata: { name: 'n2' }, spec: { drivers: [] } },
    ];
    const cov = nodeCoverage(nodes, node, [pod('np-1', 'n1', true), pod('np-2', 'n2', false, 4)], DRIVER, csiNodes);
    expect(cov.map(c => [c.node, c.tone, c.word])).toEqual([
      ['n1', 'ok', 'Can mount'],
      ['n2', 'err', 'Node plugin not ready'],
      ['n3', 'err', 'Cannot mount'],
      ['n4', 'err', 'Cannot mount'],
      ['n5', 'idle', 'Cannot mount'],
    ]);
    expect(cov[1].health).toMatchObject({ ready: false, restarts: 4, reason: 'CrashLoopBackOff', readyContainers: 1, containers: 2 });
    expect(cov[2].why).toMatch(/control-plane:NoSchedule/);
    expect(cov[3].why).toMatch(/DaemonSet has not placed/);
    expect(cov[4].why).toMatch(/not ready/);
    expect(cov[0].registered).toBe(true);
    expect(cov[2].registered).toBe(false);
  });

  it('flags a ready pod the kubelet has not registered', () => {
    const cov = nodeCoverage([n('n2')], node, [pod('np-2', 'n2', true)], DRIVER, [{ metadata: { name: 'n2' }, spec: { drivers: [] } }]);
    expect(cov[0]).toMatchObject({ tone: 'warn', word: 'Not registered with the kubelet' });
  });

  it('reads images, rollouts and pod health', () => {
    expect(imagesOf(ctrl).map(i => [i.container, i.version])).toEqual([
      ['csi-rbdplugin', 'v3.18.1'],
      ['csi-provisioner', 'v6.3.0'],
    ]);
    expect(versionOf('registry:5000/x/y')).toBe('latest');
    expect(versionOf('quay.io/a/b@sha256:0123456789abcdef0123')).toBe('sha256:0123456789ab');
    expect(rollout(ctrl)).toMatchObject({ ready: 1, want: 1, tone: 'ok', word: 'Ready' });
    expect(rollout(node)).toMatchObject({ ready: 2, want: 3, tone: 'warn', word: 'Degraded' });
    expect(rollout(undefined)).toMatchObject({ tone: 'idle', word: 'Not found' });
    expect(podHealth(pod('x', 'n', true))).toMatchObject({ ready: true, restarts: 0 });
  });

  it('finds the ceph-csi operator', () => {
    expect(csiOperator([ctrl, { metadata: { name: 'ceph-csi-controller-manager' } }])?.metadata.name).toBe('ceph-csi-controller-manager');
    expect(csiOperator([ctrl])).toBeUndefined();
  });
});

describe('a Driver’s image set', () => {
  const driver = (imageSet?: unknown): Obj => ({
    apiVersion: 'csi.ceph.io/v1',
    kind: 'Driver',
    metadata: { name: 'rook-ceph.rbd.csi.ceph.com', namespace: 'rook-ceph' },
    spec: { fsGroupPolicy: 'File', ...(imageSet === undefined ? {} : { imageSet }) },
  });

  it('is none without spec.imageSet (the OperatorConfig’s set applies)', () => {
    expect(driverImageSet(driver(), true)).toBeNull();
    expect(driverImageSet(driver({}), true)).toBeNull();
    expect(driverImageSet(undefined, true)).toBeNull();
  });

  it('is k4all’s only for a k4all-cephcsi- ConfigMap on a k4all cluster', () => {
    expect(driverImageSet(driver({ name: 'k4all-cephcsi-v3.18.2-rocky9' }), true)).toEqual({ name: 'k4all-cephcsi-v3.18.2-rocky9', k4all: true });
    expect(driverImageSet(driver({ name: 'k4all-cephcsi-v3.18.2-rocky9' }), false)).toEqual({ name: 'k4all-cephcsi-v3.18.2-rocky9', k4all: false });
    expect(driverImageSet(driver({ name: 'my-cephcsi-images' }), true)).toEqual({ name: 'my-cephcsi-images', k4all: false });
    expect(driverImageSet(driver({ name: 'rook-csi-operator-image-set-configmap' }), true)).toEqual({ name: 'rook-csi-operator-image-set-configmap', k4all: false });
  });
});
