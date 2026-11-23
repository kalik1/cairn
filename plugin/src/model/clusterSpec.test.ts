import {
  addNodeDevices,
  clusterState,
  crashCollectorDisabled,
  readStorage,
  rookMutes,
  setDeviceFilter,
  setRookMute,
  validateDevice,
} from './clusterSpec';
import { Obj } from './types';

/** A sample CephCluster (status trimmed). */
const SAMPLE_CC: Obj = {
  apiVersion: 'ceph.rook.io/v1',
  kind: 'CephCluster',
  metadata: { name: 'rook-ceph', namespace: 'rook-ceph', generation: 2, resourceVersion: '1' },
  spec: {
    cephVersion: { image: 'quay.io/ceph/ceph:v20.2.4' },
    crashCollector: { disable: true },
    mon: { count: 3, allowMultiplePerNode: false },
    storage: { deviceFilter: '^sdb$', useAllDevices: false, useAllNodes: true },
  },
  status: {
    phase: 'Ready',
    state: 'Created',
    message: 'Cluster created successfully',
    observedGeneration: 2,
    conditions: [{ type: 'Ready', status: 'True', reason: 'ClusterCreated', message: 'Cluster created successfully' }],
    version: { image: 'quay.io/ceph/ceph:v20.2.4', version: '20.2.4-0' },
  },
};

const OSD_NODES = ['kube-node-2.example.com', 'kube-node-1.example.com', 'kube-node-3.example.com'];

describe('storage spec', () => {
  it('reads the sample spec', () => {
    const v = readStorage(SAMPLE_CC);
    expect(v).toMatchObject({ useAllNodes: true, useAllDevices: false, deviceFilter: '^sdb$', nodes: [] });
    expect(v.summary).toBe('Rook uses empty disks whose name matches ^sdb$ on every node.');
  });

  it('validates device names and paths', () => {
    expect(validateDevice('sdc')).toBeNull();
    expect(validateDevice('nvme0n1')).toBeNull();
    expect(validateDevice('/dev/disk/by-id/ata-ST4000DM004-2CV104_ZFN0')).toBeNull();
    expect(validateDevice('/dev/sdc')).toMatch(/without \/dev\//);
    expect(validateDevice('')).toBeTruthy();
    expect(validateDevice('sd c')).toBeTruthy();
  });

  it('adding a device with useAllNodes lists the current OSD nodes', () => {
    const c = addNodeDevices(SAMPLE_CC, 'kube-node-4.example.com', ['sdc', '/dev/disk/by-id/wwn-0x5000'], OSD_NODES);
    const st = c.after.spec.storage;
    expect(st.useAllNodes).toBe(false);
    expect(st.deviceFilter).toBe('^sdb$');
    expect(st.nodes.map((n: any) => n.name)).toEqual([...[...OSD_NODES].sort(), 'kube-node-4.example.com']);
    expect(st.nodes[3].devices).toEqual([{ name: 'sdc' }, { name: '/dev/disk/by-id/wwn-0x5000' }]);
    expect(st.nodes[0].devices).toBeUndefined();
    expect(c.warnings[0]).toMatch(/useAllNodes is switched off/);
    expect(c.notes[0]).toMatch(/osd-prepare job on kube-node-4/);
    // the input is not changed
    expect(SAMPLE_CC.spec.storage.useAllNodes).toBe(true);
  });

  it('adding a disk to a listed node appends without duplicates', () => {
    const cc = { ...SAMPLE_CC, spec: { storage: { useAllNodes: false, nodes: [{ name: 'a', devices: [{ name: 'sdb' }] }] } } };
    const c = addNodeDevices(cc, 'a', ['sdb', 'sdc'], ['a']);
    expect(c.after.spec.storage.nodes).toEqual([{ name: 'a', devices: [{ name: 'sdb' }, { name: 'sdc' }] }]);
    expect(c.warnings).toEqual([]);
    expect(addNodeDevices(cc, 'a', ['sdb'], ['a']).noop).toBe(true);
  });

  it('refuses bad input', () => {
    expect(() => addNodeDevices(SAMPLE_CC, '', ['sdc'], [])).toThrow(/node/);
    expect(() => addNodeDevices(SAMPLE_CC, 'a', [], [])).toThrow(/device/);
    expect(() => addNodeDevices(SAMPLE_CC, 'a', ['/dev/sdc'], [])).toThrow(/without/);
  });

  it('changes the device filter and tells what it matches', () => {
    const c = setDeviceFilter(SAMPLE_CC, '^sd[bc]$', ['sda', 'sdb', 'sdc']);
    expect(c.after.spec.storage.deviceFilter).toBe('^sd[bc]$');
    expect(c.matches).toEqual(['sdb', 'sdc']);
    expect(c.warnings).toEqual([]);
    expect(setDeviceFilter(SAMPLE_CC, 'sdb').warnings[0]).toMatch(/not anchored/);
    expect(setDeviceFilter(SAMPLE_CC, '^sdb$').noop).toBe(true);
    expect(() => setDeviceFilter(SAMPLE_CC, '^sd[')).toThrow(/regular expression/);
  });
});

describe('Rook mutes', () => {
  it('mutes and unmutes through the spec', () => {
    const m = setRookMute(SAMPLE_CC, 'AUTH_INSECURE_KEYS_CREATABLE', 'mute');
    expect(m.after.spec.healthCheck.muteHealthWarning).toEqual({ AUTH_INSECURE_KEYS_CREATABLE: { policy: 'mute' } });
    expect(rookMutes(m.after)).toEqual({ AUTH_INSECURE_KEYS_CREATABLE: 'mute' });
    const u = setRookMute(m.after, 'AUTH_INSECURE_KEYS_CREATABLE', 'unmute');
    expect(rookMutes(u.after)).toEqual({ AUTH_INSECURE_KEYS_CREATABLE: 'unmute' });
    expect(m.notes.join(' ')).toMatch(/removing the entry does not unmute/);
    expect(setRookMute(m.after, 'AUTH_INSECURE_KEYS_CREATABLE', 'mute').noop).toBe(true);
  });

  it('respects the CRD rules', () => {
    expect(() => setRookMute(SAMPLE_CC, 'MON_MSGR2_NOT_ENABLED', 'mute')).toThrow(/letters and underscores/);
    const full: Obj = { ...SAMPLE_CC, spec: { healthCheck: { muteHealthWarning: Object.fromEntries('ABCDEFGHIJ'.split('').map(l => [`X_${l}`, { policy: 'mute' }])) } } };
    expect(() => setRookMute(full, 'OSD_DOWN', 'mute')).toThrow(/at most 10/);
    expect(setRookMute(full, 'X_A', 'unmute').after.spec.healthCheck.muteHealthWarning.X_A).toEqual({ policy: 'unmute' });
  });
});

describe('cluster state', () => {
  it('reads the sample CephCluster', () => {
    expect(crashCollectorDisabled(SAMPLE_CC)).toBe(true);
    const s = clusterState(SAMPLE_CC);
    expect(s).toMatchObject({ phase: 'Ready', ready: true, pending: false, cephVersion: '20.2.4', generation: 2, observedGeneration: 2 });
  });

  it('notices a pending or failing reconcile', () => {
    const cc = { ...SAMPLE_CC, metadata: { ...SAMPLE_CC.metadata, generation: 3 }, status: { ...SAMPLE_CC.status, phase: 'Progressing' } };
    const s = clusterState(cc);
    expect(s.pending).toBe(true);
    expect(s.ready).toBe(false);
  });
});
