import { SAMPLE } from './fixtures.sample';
import {
  backing,
  CLUSTER_FLAGS,
  fillTone,
  fillWord,
  flagCommand,
  maintenancePlan,
  osdCmd,
  osdStateWord,
  osdTone,
  parseOkToStop,
  parseReweight,
  parseSafeToDestroy,
  ratiosOf,
  setFlags,
  shelves,
} from './osd';
import { buildOsdTree, parseOsdMap, parseOsdMetadata } from './parse';

const tree = () => buildOsdTree(SAMPLE.osdDfTree, SAMPLE.osdDump, SAMPLE.osdPerf, parseOsdMetadata(SAMPLE.osdMetadata));

describe('osd state', () => {
  it('words and tones', () => {
    expect(osdStateWord({ up: true, in: true })).toBe('Up, in');
    expect(osdStateWord({ up: false, in: false })).toBe('Down, out');
    expect(osdTone({ up: true, in: true })).toBe('ok');
    expect(osdTone({ up: true, in: false })).toBe('warn');
    expect(osdTone({ up: false, in: true })).toBe('err');
  });

  it('fill against ratios', () => {
    const r = ratiosOf(parseOsdMap(SAMPLE.osdDump));
    expect(r.nearFull).toBeCloseTo(0.85);
    expect(fillTone(10, r)).toBe('ok');
    expect(fillTone(76, r)).toBe('warn');
    expect(fillTone(91, r)).toBe('err');
    expect(fillWord(80, r)).toBe('Filling up');
    expect(fillWord(86, r)).toBe('Near full');
    expect(fillWord(96, r)).toBe('Full: writes stop');
  });

  it('backing device from metadata', () => {
    const o = tree().osds.find(x => x.id === 0)!;
    const b = backing(o);
    expect(b.node).toBe('kube-node-2.example.com');
    expect(b.device).toBe('sdb');
    expect(b.path).toMatch(/^\/dev\/disk\/by-path\//);
    expect(b.deviceId).toBe('QEMU_QEMU_HARDDISK_DISK-OSD2');
    expect(b.rotational).toBe(true);
    expect(b.type).toBe('bluestore on hdd');
    expect(b.pod).toBe('rook-ceph-osd-0-7c9d8b6f5-aaaaa');
  });
});

describe('cluster flags', () => {
  it('explains every flag the brief lists', () => {
    const names = CLUSTER_FLAGS.map(f => f.flag);
    expect(names).toEqual(['noout', 'noin', 'nodown', 'noup', 'norebalance', 'norecover', 'nobackfill', 'noscrub', 'nodeep-scrub', 'pause']);
    expect(CLUSTER_FLAGS.find(f => f.flag === 'pause')?.danger).toBeTruthy();
  });

  it('reads set flags, pause from pauserd/pausewr', () => {
    expect([...setFlags(parseOsdMap(SAMPLE.osdDump))]).toEqual([]);
    const m = parseOsdMap({ ...SAMPLE.osdDump, flags: 'pauserd,pausewr,noout,sortbitwise' });
    expect(setFlags(m).has('pause')).toBe(true);
    expect(setFlags(m).has('noout')).toBe(true);
    expect(setFlags(m).has('sortbitwise')).toBe(false);
  });

  it('builds set/unset commands', () => {
    expect(flagCommand('noscrub', true)).toEqual({ prefix: 'osd set', key: 'noscrub' });
    expect(flagCommand('noscrub', false)).toEqual({ prefix: 'osd unset', key: 'noscrub' });
  });
});

describe('osd commands', () => {
  it('passes ids as strings', () => {
    expect(osdCmd.out([2, 1])).toEqual({ prefix: 'osd out', ids: ['2', '1'] });
    expect(osdCmd.okToStop([0])).toEqual({ prefix: 'osd ok-to-stop', ids: ['0'] });
    expect(osdCmd.reweight(1, 0.8)).toEqual({ prefix: 'osd reweight', id: 1, weight: 0.8 });
    expect(osdCmd.scrub(3)).toEqual({ prefix: 'osd scrub', who: '3' });
  });

  it('parses reweight input', () => {
    expect(parseReweight('0.85')).toBe(0.85);
    expect(parseReweight('85%')).toBe(0.85);
    expect(parseReweight('1')).toBe(1);
    expect(parseReweight('1.2')).toBeNull();
    expect(parseReweight('-1')).toBeNull();
    expect(parseReweight('abc')).toBeNull();
  });
});

describe('safety checks', () => {
  it('reads a refused ok-to-stop (real answer)', () => {
    const c = parseOkToStop({
      r: -11,
      out: { ok_to_stop: false, osds: [0], num_ok_pgs: 12, num_not_ok_pgs: 1, unknown_pgs: ['4.0'], bad_already_inactive: ['3.0'], ok_become_degraded: ['1.0', '1.4'] },
      err: '1 pgs have unknown state; cannot draw any conclusions',
    })!;
    expect(c.ok).toBe(false);
    expect(c.message).toMatch(/unknown state/);
    expect(c).toMatchObject({ okPgs: 12, notOkPgs: 1, unknown: ['4.0'], alreadyInactive: ['3.0'], becomeDegraded: ['1.0', '1.4'] });
  });

  it('reads an accepted ok-to-stop', () => {
    const c = parseOkToStop({ r: 0, out: { ok_to_stop: true, osds: [1], num_ok_pgs: 20, num_not_ok_pgs: 0, ok_become_degraded: ['1.1'] }, err: '' })!;
    expect(c.ok).toBe(true);
    expect(c.becomeDegraded).toEqual(['1.1']);
  });

  it('reads safe-to-destroy', () => {
    expect(parseSafeToDestroy({ r: -16, out: null, err: 'OSD(s) 0 have 12 pgs currently mapped to them. ' })).toEqual({
      safe: false,
      message: 'OSD(s) 0 have 12 pgs currently mapped to them.',
    });
    expect(parseSafeToDestroy({ r: 0, out: null, err: '' })?.safe).toBe(true);
  });
});

describe('maintenance plan', () => {
  it('host: noout on the bucket, optional out, then undo in reverse', () => {
    const p = maintenancePlan({ osds: [2, 0], host: 'kube-worker-x', markOut: true });
    expect(p.start.map(s => s.cmd)).toEqual([
      { prefix: 'osd set-group', flags: 'noout', who: ['kube-worker-x'] },
      { prefix: 'osd out', ids: ['0', '2'] },
    ]);
    expect(p.finish.map(s => s.cmd)).toEqual([
      { prefix: 'osd in', ids: ['0', '2'] },
      { prefix: 'osd unset-group', flags: 'noout', who: ['kube-worker-x'] },
    ]);
    expect(p.consequences[0]).toMatch(/moving every placement group/);
  });

  it('single OSD without out: per-OSD noout only', () => {
    const p = maintenancePlan({ osds: [1], markOut: false });
    expect(p.start.map(s => s.cmd)).toEqual([{ prefix: 'osd add-noout', ids: ['1'] }]);
    expect(p.finish.map(s => s.cmd)).toEqual([{ prefix: 'osd rm-noout', ids: ['1'] }]);
    expect(p.consequences[0]).toMatch(/Nothing moves now/);
  });
});

describe('shelves', () => {
  it('one shelf per CRUSH host with its node name', () => {
    const t = tree();
    const s = shelves(t.hosts, t.osds);
    expect(s).toHaveLength(3);
    expect(s.every(x => x.osds.length === 1)).toBe(true);
    expect(s.map(x => x.node)).toContain('kube-node-2.example.com');
    expect(s[0].up).toBe(1);
  });

  it('puts OSDs outside any host on a last shelf', () => {
    const t = tree();
    const s = shelves(t.hosts.slice(0, 2), t.osds);
    expect(s).toHaveLength(3);
    expect(s[2].host).toBe('');
  });
});
