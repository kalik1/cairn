import { AlertInput, deriveAlerts } from './alerts';
import { SAMPLE } from './fixtures.sample';
import { buildOsdTree, parseAutoscale, parseCrushRules, parseDf, parseMgr, parseOsdMap, parseOsdMetadata, parsePools, parseQuorum } from './parse';
import { Obj } from './types';

const CC: Obj = {
  metadata: { name: 'rook-ceph', namespace: 'rook-ceph', generation: 2 },
  spec: { crashCollector: { disable: true } },
  status: { phase: 'Ready', observedGeneration: 2, conditions: [{ type: 'Ready', status: 'True' }] },
};

const runningPod: Obj = {
  metadata: { name: 'rook-ceph-operator-x', namespace: 'rook-ceph' },
  status: { phase: 'Running', containerStatuses: [{ ready: true }] },
};

function sample(): AlertInput {
  const osdMap = parseOsdMap(SAMPLE.osdDump);
  const tree = buildOsdTree(SAMPLE.osdDfTree, SAMPLE.osdDump, SAMPLE.osdPerf, parseOsdMetadata(SAMPLE.osdMetadata));
  return {
    osdMap,
    osds: tree.osds,
    quorum: parseQuorum(SAMPLE.quorum),
    mgr: parseMgr({ active_name: 'a', available: true, standbys: [] }),
    pools: parsePools(SAMPLE.poolLs, parseDf(SAMPLE.df).pools, parseCrushRules(SAMPLE.crushRules), osdMap.ecProfiles),
    autoscale: parseAutoscale(SAMPLE.autoscale),
    crashes: [],
    cephCluster: CC,
    operator: { deployment: { metadata: { name: 'rook-ceph-operator', namespace: 'rook-ceph' }, status: { availableReplicas: 1 } }, pods: [runningPod], looked: true },
    now: Date.parse('2026-11-23T04:00:00Z'),
  };
}

const ids = (i: AlertInput) => deriveAlerts(i).map(a => a.id);

describe('Cairn alerts', () => {
  it('sample: no standby manager and crash collector off', () => {
    const a = deriveAlerts(sample());
    expect(a.map(x => x.id)).toEqual(['mgr-standby', 'crash-collector']);
    expect(a[0].title).toBe('No standby manager behind mgr.a');
    expect(a[0].link).toEqual({ view: 'daemons', a: 'mgr', label: 'Open Managers' });
  });

  it('cluster flags, pause is an error', () => {
    const i = sample();
    i.osdMap = parseOsdMap({ ...SAMPLE.osdDump, flags: 'sortbitwise,noout,noscrub' });
    const f = deriveAlerts(i).find(a => a.id === 'flags')!;
    expect(f.tone).toBe('warn');
    expect(f.title).toBe('Cluster flags are set: noout, noscrub');
    i.osdMap = parseOsdMap({ ...SAMPLE.osdDump, flags: 'pauserd,pausewr' });
    const p = deriveAlerts(i).find(a => a.id === 'flags')!;
    expect(p).toMatchObject({ tone: 'err', title: 'The cluster flag pause is set' });
  });

  it('OSDs down, out and filling', () => {
    const i = sample();
    i.osds = i.osds.map(o => (o.id === 1 ? { ...o, up: false } : o.id === 2 ? { ...o, in: false } : { ...o, utilization: 80 }));
    const a = deriveAlerts(i);
    expect(a[0]).toMatchObject({ id: 'osd-down', tone: 'err', title: '1 OSD is down: osd.1', link: { view: 'osds', a: '1' } });
    expect(a.find(x => x.id === 'osd-out')?.title).toBe('1 OSD is out: osd.2');
    expect(a.find(x => x.id === 'osd-filling')?.title).toBe('1 OSD above 75% full: osd.0 80%');
  });

  it('above near-full is left to Ceph', () => {
    const i = sample();
    i.osds = i.osds.map(o => ({ ...o, utilization: 90 }));
    expect(ids(i)).not.toContain('osd-filling');
  });

  it('monitors out of quorum', () => {
    const i = sample();
    i.quorum = { ...i.quorum!, quorum: ['a', 'b'], mons: i.quorum!.mons.map(m => (m.name === 'c' ? { ...m, inQuorum: false } : m)) };
    const m = deriveAlerts(i).find(a => a.id === 'mon-quorum')!;
    expect(m.tone).toBe('err');
    expect(m.title).toBe('1 monitor out of quorum: mon.c');
    expect(m.detail).toMatch(/Losing one more stops the cluster/);
  });

  it('a Rook operator that does not run, a CephCluster that is not ready', () => {
    const i = sample();
    i.operator = { deployment: { metadata: { name: 'rook-ceph-operator', namespace: 'rook-ceph' }, status: { availableReplicas: 0 } }, pods: [], looked: true };
    i.cephCluster = { ...CC, status: { phase: 'Progressing', message: 'Configuring Ceph OSDs' } };
    const a = deriveAlerts(i);
    expect(a.find(x => x.id === 'operator')?.tone).toBe('err');
    expect(a.find(x => x.id === 'cc-ready')).toMatchObject({ tone: 'warn', detail: 'Configuring Ceph OSDs' });
  });

  it('weak pools', () => {
    const i = sample();
    i.pools = i.pools.map((p, n) => (n === 0 ? { ...p, size: 2, minSize: 1 } : p));
    const a = ids(i);
    expect(a).toContain(`pool-size-${i.pools[0].id}`);
    expect(a).toContain(`pool-min-${i.pools[0].id}`);
  });

  it('autoscaler and recent crashes', () => {
    const i = sample();
    i.autoscale = [{ ...i.autoscale[0], wouldAdjust: true, pgNumFinal: 64, mode: 'warn' }];
    i.crashes = [
      { id: 'c1', entity: 'osd.1', time: Date.parse('2026-11-23T01:00:00Z'), archived: false },
      { id: 'c0', entity: 'osd.0', time: Date.parse('2026-10-01T01:00:00Z'), archived: false },
      { id: 'c2', entity: 'mon.a', time: Date.parse('2026-11-22T01:00:00Z'), archived: true },
    ];
    const a = deriveAlerts(i);
    expect(a.find(x => x.id.startsWith('autoscale'))?.detail).toMatch(/waits for you/);
    expect(a.find(x => x.id === 'crashes')?.title).toBe('1 new crash report, the latest from osd.1 3 h ago');
  });

  it('sorts errors first', () => {
    const i = sample();
    i.osds = i.osds.map(o => (o.id === 0 ? { ...o, up: false } : o));
    const tones = deriveAlerts(i).map(a => a.tone);
    expect(tones).toEqual([...tones].sort((x, y) => ['err', 'warn', 'idle'].indexOf(x) - ['err', 'warn', 'idle'].indexOf(y)));
  });
});
