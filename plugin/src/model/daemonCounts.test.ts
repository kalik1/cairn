import {
  cephMajor,
  cephReleaseName,
  ignoredModuleReason,
  matchesNodeAffinity,
  mgrCount,
  mgrOptions,
  monCount,
  MonFacts,
  monFailuresTolerated,
  monOptions,
  placeableNodes,
  quorumNeeds,
  removeMgrModule,
  runningCephVersion,
  setMgrCount,
  setMonCount,
  tolerates,
} from './daemonCounts';
import { jsonPatch } from './patch';
import { Obj } from './types';

const cc = (spec: any = {}, status: any = {}): Obj => ({
  apiVersion: 'ceph.rook.io/v1',
  kind: 'CephCluster',
  metadata: { name: 'rook-ceph', namespace: 'rook-ceph', generation: 3 },
  spec: {
    cephVersion: { image: 'quay.io/ceph/ceph:v20.2.4' },
    mon: { count: 3, allowMultiplePerNode: false },
    mgr: { count: 1, modules: [{ name: 'rook', enabled: true }] },
    resources: { mgr: { requests: { cpu: '100m', memory: '512Mi' } } },
    ...spec,
  },
  status: { version: { image: 'quay.io/ceph/ceph:v20.2.4', version: '20.2.4-0' }, ...status },
});

const node = (name: string, extra: { labels?: Record<string, string>; taints?: any[]; unschedulable?: boolean } = {}): Obj => ({
  apiVersion: 'v1',
  kind: 'Node',
  metadata: { name, labels: { 'kubernetes.io/hostname': name, ...(extra.labels ?? {}) } },
  spec: { taints: extra.taints, unschedulable: extra.unschedulable },
});

const NODES3 = ['node-a.example.com', 'node-b.example.com', 'node-c.example.com'];
const facts = (placeable: string[] | null, monmap: string[] | null = ['a', 'b', 'c'], inQuorum: string[] = monmap ?? []): MonFacts => ({
  placeable,
  monmap,
  inQuorum,
});
const opt = (list: { value: number }[], v: number) => list.find(o => o.value === v) as any;

describe('Ceph version detection', () => {
  it('reads every shape Cairn sees', () => {
    expect(cephMajor('20.2.4-0')).toBe(20);
    expect(cephMajor('20.2.4')).toBe(20);
    expect(cephMajor('v19.2.3')).toBe(19);
    expect(cephMajor('ceph version 20.2.4 (7f793731f1b39eb4f465e960113d2363c311b964) tentacle (stable - RelWithDebInfo)')).toBe(20);
    expect(cephMajor('ceph version 18.2.7 (0000000) reef (stable)')).toBe(18);
    expect(cephMajor('quay.io/ceph/ceph:v20.2.4')).toBe(20);
    expect(cephMajor('quay.io/ceph/ceph:v19.2.3-20250717')).toBe(19);
    expect(cephMajor('')).toBeNull();
    expect(cephMajor(undefined)).toBeNull();
    expect(cephMajor('quay.io/ceph/ceph:latest')).toBeNull();
    expect(cephMajor('Unknown')).toBeNull();
  });

  it('names releases', () => {
    expect(cephReleaseName(20)).toBe('Tentacle');
    expect(cephReleaseName(19)).toBe('Squid');
    expect(cephReleaseName(null)).toBe('');
  });

  it('prefers what Rook detected, then the managers, then the image', () => {
    expect(runningCephVersion(cc())).toBe('20.2.4');
    const noStatus = { ...cc(), status: {} };
    expect(
      runningCephVersion(noStatus, {
        mgr: { 'ceph version 20.2.4 (7f79) tentacle (stable)': 1, 'ceph version 19.2.3 (c92a) squid (stable)': 1 },
      })
    ).toBe('19.2.3');
    expect(runningCephVersion(noStatus, null)).toBe('20.2.4');
    expect(runningCephVersion({ metadata: { name: 'x' }, spec: {} })).toBe('');
  });
});

describe('node placement', () => {
  it('applies Kubernetes toleration rules', () => {
    const t = { key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' };
    expect(tolerates({ key: 'node-role.kubernetes.io/control-plane', operator: 'Exists' }, t)).toBe(true);
    expect(tolerates({ operator: 'Exists' }, t)).toBe(true);
    expect(tolerates({ key: 'node-role.kubernetes.io/control-plane', operator: 'Exists', effect: 'NoExecute' }, t)).toBe(false);
    expect(tolerates({ key: 'storage', operator: 'Equal', value: 'ceph' }, { key: 'storage', value: 'ceph', effect: 'NoSchedule' })).toBe(true);
    expect(tolerates({ key: 'storage', value: 'other' }, { key: 'storage', value: 'ceph', effect: 'NoSchedule' })).toBe(false);
  });

  it('matches required node affinity', () => {
    const aff = { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'role', operator: 'In', values: ['storage'] }] }] } };
    expect(matchesNodeAffinity(node('a', { labels: { role: 'storage' } }), aff)).toBe(true);
    expect(matchesNodeAffinity(node('b'), aff)).toBe(false);
    expect(matchesNodeAffinity(node('b'), undefined)).toBe(true);
    const byName = { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'NotIn', values: ['b'] }] }] } };
    expect(matchesNodeAffinity(node('a'), byName)).toBe(true);
    expect(matchesNodeAffinity(node('b'), byName)).toBe(false);
  });

  it('counts the nodes a monitor can run on', () => {
    const nodes = [
      node('node-a.example.com'),
      node('node-b.example.com', { taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] }),
      node('node-c.example.com', { unschedulable: true }),
      node('node-d.example.com', { taints: [{ key: 'noisy', effect: 'PreferNoSchedule' }] }),
    ];
    expect(placeableNodes(nodes, cc(), 'mon')).toEqual(['node-a.example.com', 'node-d.example.com']);
    const tolerant = cc({ placement: { all: { tolerations: [{ key: 'node-role.kubernetes.io/control-plane', operator: 'Exists' }] } } });
    expect(placeableNodes(nodes, tolerant, 'mon')).toEqual(['node-a.example.com', 'node-b.example.com', 'node-d.example.com']);
    // the mon placement replaces placement.all's node affinity
    const pinned = cc({
      placement: {
        all: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'x', operator: 'Exists' }] }] } } },
        mon: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: ['node-d.example.com'] }] }] } } },
      },
    });
    expect(placeableNodes(nodes, pinned, 'mon')).toEqual(['node-d.example.com']);
    expect(placeableNodes(nodes, pinned, 'mgr')).toEqual([]);
  });
});

describe('manager count', () => {
  it('reads the count, 1 by default', () => {
    expect(mgrCount(cc())).toBe(1);
    expect(mgrCount(cc({ mgr: { count: 2 } }))).toBe(2);
    expect(mgrCount(cc({ mgr: {} }))).toBe(1);
  });

  it('offers 1 and 2 when two nodes can run a manager', () => {
    const o = mgrOptions(cc(), { placeable: NODES3 });
    expect(o.map(x => [x.value, x.current, x.off])).toEqual([
      [1, true, null],
      [2, false, null],
    ]);
    expect(o[0].meaning).toMatch(/metrics, the dashboard, progress events, the PG autoscaler and the balancer stop/);
    expect(o[0].meaning).toMatch(/Client I\/O is not affected/);
    expect(o[1].meaning).toMatch(/standby takes over as soon as the monitors miss its beacons \(about 30 seconds\)/);
  });

  it('turns 2 off on a single node unless several per node are allowed', () => {
    expect(opt(mgrOptions(cc(), { placeable: ['node-a.example.com'] }), 2).off).toBe('Needs 2 nodes that can run a manager, one per node; 1 node can');
    expect(opt(mgrOptions(cc(), { placeable: null }), 2).off).toMatch(/cannot list the nodes/);
    expect(opt(mgrOptions(cc({ mgr: { count: 1, allowMultiplePerNode: true } }), { placeable: ['node-a.example.com'] }), 2).off).toBeNull();
  });

  it('never offers more than two, but shows a larger current count', () => {
    const o = mgrOptions(cc({ mgr: { count: 3 } }), { placeable: NODES3 });
    expect(o.map(x => x.value)).toEqual([1, 2, 3]);
    expect(opt(o, 3).current).toBe(true);
    expect(() => setMgrCount(cc(), 3, { placeable: NODES3 })).toThrow(/one or two/);
  });

  it('builds the change 1 → 2 as one field', () => {
    const before = cc();
    const ch = setMgrCount(before, 2, { placeable: NODES3 });
    expect(ch.after.spec.mgr).toEqual({ count: 2, modules: [{ name: 'rook', enabled: true }] });
    expect(ch.notes[0]).toMatch(/rook-ceph-mgr-b\) on another node/);
    expect(ch.notes[1]).toMatch(/running manager restarts once/);
    expect(ch.notes.join(' ')).toMatch(/cpu 100m, memory 512Mi/);
    expect(jsonPatch(before, ch.after)).toEqual([
      { op: 'test', path: '/spec/mgr/count', value: 1 },
      { op: 'replace', path: '/spec/mgr/count', value: 2 },
    ]);
    expect(before.spec.mgr.count).toBe(1);
  });

  it('adds the count when the spec has none, and goes back to 1', () => {
    const ch = setMgrCount(cc({ mgr: undefined }), 2, { placeable: NODES3 });
    expect(ch.after.spec.mgr).toEqual({ count: 2 });
    const down = setMgrCount(cc({ mgr: { count: 2 } }), 1, { placeable: NODES3 });
    expect(down.after.spec.mgr.count).toBe(1);
    expect(down.notes[0]).toMatch(/restarts mgr\.a without its watch-active sidecar, then deletes rook-ceph-mgr-b/);
    expect(setMgrCount(cc(), 1, { placeable: NODES3 }).noop).toBe(true);
    expect(() => setMgrCount(cc(), 2, { placeable: ['node-a.example.com'] })).toThrow(/Needs 2 nodes/);
  });
});

describe('monitor count', () => {
  it('reads the count, 3 by default, and the quorum arithmetic', () => {
    expect(monCount(cc())).toBe(3);
    expect(monCount(cc({ mon: {} }))).toBe(3);
    expect(monCount(cc({ mon: { count: 5 } }))).toBe(5);
    expect([1, 2, 3, 4, 5].map(quorumNeeds)).toEqual([1, 2, 2, 3, 3]);
    expect([1, 2, 3, 4, 5].map(monFailuresTolerated)).toEqual([0, 0, 1, 1, 2]);
  });

  it('on three nodes: 5 is off with the reason, 1 needs a confirmation', () => {
    const o = monOptions(cc(), facts(NODES3));
    expect(o.map(x => x.value)).toEqual([1, 3, 5]);
    expect(opt(o, 3)).toMatchObject({ current: true, off: null, confirm: null });
    expect(opt(o, 5).off).toBe('Needs 5 nodes that can run a monitor, one per node; 3 nodes can');
    expect(opt(o, 1).off).toBeNull();
    expect(opt(o, 1).confirm).toMatch(/tolerates no monitor failure, although 3 nodes could run three/);
    expect(opt(o, 3).meaning).toBe('Quorum needs 2 of 3: the cluster keeps running with 1 monitor down.');
    expect(opt(o, 5).meaning).toBe('Quorum needs 3 of 5: the cluster keeps running with 2 monitors down.');
  });

  it('on five nodes 5 is offered; several per node lifts the node limit', () => {
    const five = [...NODES3, 'node-d.example.com', 'node-e.example.com'];
    expect(opt(monOptions(cc(), facts(five)), 5).off).toBeNull();
    expect(opt(monOptions(cc({ mon: { count: 3, allowMultiplePerNode: true } }), facts(NODES3)), 5).off).toBeNull();
  });

  it('on fewer than three nodes 1 needs no confirmation', () => {
    const two = ['node-a.example.com', 'node-b.example.com'];
    const o = monOptions(cc({ mon: { count: 3, allowMultiplePerNode: true } }), facts(two));
    expect(opt(o, 1)).toMatchObject({ off: null, confirm: null });
    const one = monOptions(cc({ mon: { count: 1 } }), facts(['node-a.example.com'], ['a']));
    expect(opt(one, 3).off).toMatch(/Needs 3 nodes/);
  });

  it('never offers a change while a monitor is out of quorum', () => {
    const f = facts([...NODES3, 'node-d.example.com', 'node-e.example.com'], ['a', 'b', 'c'], ['a', 'b']);
    const o = monOptions(cc(), f);
    expect(opt(o, 1).off).toMatch(/mon\.c is out of quorum/);
    expect(opt(o, 5).off).toMatch(/mon\.c is out of quorum/);
    expect(opt(o, 3).off).toBeNull();
    expect(() => setMonCount(cc(), 5, f)).toThrow(/out of quorum/);
  });

  it('waits while Rook is still adding or removing monitors, and without the quorum', () => {
    const five = [...NODES3, 'node-d.example.com', 'node-e.example.com'];
    expect(opt(monOptions(cc({ mon: { count: 5 } }), facts(five, ['a', 'b', 'c', 'd'])), 3).off).toMatch(/still moving to 5 monitors \(the monmap has 4\)/);
    expect(opt(monOptions(cc(), facts(five, null)), 5).off).toMatch(/needs the live quorum/);
  });

  it('shows an even current count and offers only odd ones', () => {
    const o = monOptions(cc({ mon: { count: 4 } }), facts([...NODES3, 'node-d.example.com', 'node-e.example.com'], ['a', 'b', 'c', 'd']));
    expect(o.map(x => x.value)).toEqual([1, 3, 4, 5]);
    expect(opt(o, 4).meaning).toMatch(/no more than with 3 \(an even count adds no tolerance\)/);
  });

  it('refuses 1 on three nodes without the confirmation, builds it with it', () => {
    expect(() => setMonCount(cc(), 1, facts(NODES3))).toThrow(/Confirm it explicitly/);
    const ch = setMonCount(cc(), 1, facts(NODES3), true);
    expect(ch.after.spec.mon).toEqual({ count: 1, allowMultiplePerNode: false });
    expect(ch.confirm).toBeTruthy();
    expect(ch.warnings[0]).toMatch(/single point of failure/);
    expect(ch.notes[0]).toMatch(/removes 2 monitors, one per monitor health check/);
  });

  it('builds 3 → 5 and 5 → 3', () => {
    const five = [...NODES3, 'node-d.example.com', 'node-e.example.com'];
    const up = setMonCount(cc(), 5, facts(five));
    expect(up.after.spec.mon.count).toBe(5);
    expect(up.notes[0]).toMatch(/adds 2 monitors, one at a time/);
    expect(up.notes[1]).toMatch(/needs 3 of 5: the cluster keeps running with 2 monitors down instead of 1/);
    expect(up.confirm).toBeNull();
    const down = setMonCount(cc({ mon: { count: 5 } }), 3, facts(five, ['a', 'b', 'c', 'd', 'e']));
    expect(down.after.spec.mon.count).toBe(3);
    expect(down.notes[1]).toMatch(/needs 2 of 3: the cluster keeps running with 1 monitor down instead of 2/);
    expect(setMonCount(cc(), 3, facts(NODES3)).noop).toBe(true);
    expect(() => setMonCount(cc(), 5, facts(NODES3))).toThrow(/Needs 5 nodes/);
    expect(() => setMonCount(cc(), 2, facts(NODES3))).toThrow(/odd count/);
  });
});

describe('mgr modules Rook ignores', () => {
  it('flags the rook module on Ceph 20 and later', () => {
    expect(ignoredModuleReason(cc(), 'rook', '20.2.4')).toMatch(/Rook disables the rook module on Ceph 20 \(Tentacle\) and later; this cluster runs Ceph 20.2.4/);
    expect(ignoredModuleReason(cc(), 'rook', '21.1.0')).toMatch(/runs Ceph 21.1.0 \(Umbrella\)/);
    expect(ignoredModuleReason(cc(), 'rook', '19.2.3')).toBeNull();
    expect(ignoredModuleReason(cc(), 'rook', '')).toBeNull();
    expect(ignoredModuleReason(cc({ mgr: { modules: [{ name: 'rook', enabled: false }] } }), 'rook', '20.2.4')).toBeNull();
    expect(ignoredModuleReason(cc({ mgr: { modules: [{ name: 'pg_autoscaler', enabled: true }] } }), 'pg_autoscaler', '20.2.4')).toBeNull();
  });

  it('removes the entry, and the list when it was the only one', () => {
    const before = cc();
    const ch = removeMgrModule(before, 'rook', '20.2.4');
    expect(ch.after.spec.mgr).toEqual({ count: 1 });
    expect(ch.notes[1]).toMatch(/changes nothing in Ceph/);
    expect(jsonPatch(before, ch.after)).toEqual([
      { op: 'test', path: '/spec/mgr/modules', value: [{ name: 'rook', enabled: true }] },
      { op: 'remove', path: '/spec/mgr/modules' },
    ]);
    const two = cc({ mgr: { count: 2, modules: [{ name: 'pg_autoscaler', enabled: true }, { name: 'rook', enabled: true }] } });
    expect(removeMgrModule(two, 'rook', '20.2.4').after.spec.mgr.modules).toEqual([{ name: 'pg_autoscaler', enabled: true }]);
    expect(removeMgrModule(two, 'pg_autoscaler', '20.2.4').notes[0]).toMatch(/does not disable a module that is on/);
    expect(removeMgrModule(cc({ mgr: { count: 1 } }), 'rook').noop).toBe(true);
    expect(before.spec.mgr.modules).toHaveLength(1);
  });
});
