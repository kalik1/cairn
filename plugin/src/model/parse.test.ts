import { SAMPLE } from './fixtures.sample';
import {
  buildOsdTree,
  parseAutoscale,
  parseConfig,
  parseCrashes,
  parseCrushRules,
  parseDf,
  parseHealth,
  parseHealthHistory,
  parseLog,
  parseOsdMap,
  parseOsdMetadata,
  parsePgBrief,
  parsePools,
  parsePoolStats,
  parseProgress,
  parseQuorum,
  parseStatus,
  parseVersions,
  shortVersion,
  withHistory,
} from './parse';

describe('status and health', () => {
  it('parses ceph status', () => {
    const s = parseStatus(SAMPLE.status);
    expect(s.health.status).toBe('HEALTH_WARN');
    expect(s.quorum).toEqual(['a', 'b', 'c']);
    expect(s.osd).toMatchObject({ total: 3, up: 3, in: 3 });
    expect(s.pg.total).toBe(33);
    expect(s.pg.byState[0]).toEqual({ state: 'active+clean', count: 33 });
    expect(s.totalBytes).toBe(257698037760);
    expect(s.mgr.modules).toContain('prometheus');
  });

  it('parses health detail with details and history', () => {
    const h = parseHealth(SAMPLE.health);
    expect(h.checks.map(c => c.code)).toEqual(['AUTH_INSECURE_KEYS_ALLOWED', 'AUTH_INSECURE_KEYS_CREATABLE']);
    expect(h.checks[0].details).toEqual(['insecure cipher aes allowed for auth']);
    const hist = parseHealthHistory(SAMPLE.healthHistory);
    expect(hist.find(e => e.code === 'PG_DEGRADED')?.active).toBe(false);
    const w = withHistory(h, hist);
    expect(w.checks[0].firstSeen).toBeGreaterThan(1.7e12);
  });

  it('sorts errors before warnings and reads mutes', () => {
    const h = parseHealth({
      status: 'HEALTH_ERR',
      checks: {
        B_WARN: { severity: 'HEALTH_WARN', summary: { message: 'w', count: 2 } },
        A_ERR: { severity: 'HEALTH_ERR', summary: { message: 'e', count: 1 } },
      },
      mutes: [{ code: 'X', ttl: '2026-11-23T05:00:00.000000+0000', sticky: true }],
    });
    expect(h.checks[0].code).toBe('A_ERR');
    expect(h.checks[1].count).toBe(2);
    expect(h.mutes[0]).toMatchObject({ code: 'X', sticky: true });
    expect(h.mutes[0].until).toBe(Date.parse('2026-11-23T05:00:00Z'));
  });

  it('parses progress events', () => {
    const p = parseProgress(SAMPLE.progress);
    expect(p.completed.length).toBeGreaterThan(0);
    expect(p.completed[0].progress).toBe(1);
  });
});

describe('OSDs', () => {
  it('builds the tree with hosts, metadata and latency', () => {
    const meta = parseOsdMetadata(SAMPLE.osdMetadata);
    const t = buildOsdTree(SAMPLE.osdDfTree, SAMPLE.osdDump, SAMPLE.osdPerf, meta);
    expect(t.osds.map(o => o.id)).toEqual([0, 1, 2]);
    expect(t.hosts).toHaveLength(3);
    const o1 = t.osds.find(o => o.id === 1)!;
    expect(o1.host).toBe('kube-node-1-example-com');
    expect(o1.up && o1.in).toBe(true);
    expect(o1.sizeBytes).toBe(85899345920);
    expect(o1.pgs).toBe(33);
    expect(o1.commitMs).toBeGreaterThanOrEqual(0);
    expect(o1.meta?.hostname).toBe('kube-node-1.example.com');
    expect(o1.meta?.devices).toEqual(['sdb']);
    expect(t.hosts.find(h => h.osds.includes(1))?.node).toBe('kube-node-1.example.com');
    expect(t.roots).toHaveLength(1);
  });

  it('reads the OSD map flags without internal ones', () => {
    const m = parseOsdMap(SAMPLE.osdDump);
    expect(m.flags).toEqual([]);
    expect(m.nearFullRatio).toBeCloseTo(0.85);
    const m2 = parseOsdMap({ ...SAMPLE.osdDump, flags: 'noout,sortbitwise,noscrub' });
    expect(m2.flags).toEqual(['noout', 'noscrub']);
  });

  it('reads per-OSD flags from the state', () => {
    const dump = { ...SAMPLE.osdDump, osds: [{ osd: 0, up: 1, in: 1, weight: 1, state: ['exists', 'up', 'noout'] }] };
    expect(parseOsdMap(dump).osdFlags).toEqual({ 0: ['noout'] });
    const grouped = parseOsdMap({ ...SAMPLE.osdDump, crush_node_flags: { 'kube-worker-a': ['noout'] }, device_class_flags: { ssd: ['noin'] } });
    expect(grouped.crushNodeFlags).toEqual({ 'kube-worker-a': ['noout'] });
    expect(grouped.deviceClassFlags).toEqual({ ssd: ['noin'] });
  });
});

describe('pools', () => {
  it('joins pools with usage and CRUSH rules', () => {
    const df = parseDf(SAMPLE.df);
    const rules = parseCrushRules(SAMPLE.crushRules);
    expect(rules[1]).toMatchObject({ name: 'vm-pool', failureDomain: 'host', root: 'default' });
    const pools = parsePools(SAMPLE.poolLs, df.pools, rules);
    const vm = pools.find(p => p.name === 'vm-pool')!;
    expect(vm).toMatchObject({ type: 'replicated', size: 3, minSize: 2, pgNum: 32, crushRule: 'vm-pool', rawFactor: 3 });
    expect(vm.applications).toEqual(['rbd']);
    expect(vm.usage?.stored).toBeGreaterThan(0);
    expect(df.byClass.hdd.total).toBe(257698037760);
  });

  it('computes the raw factor of erasure-coded pools', () => {
    const pools = parsePools(
      [{ pool: 5, pool_name: 'ec', type: 3, size: 6, erasure_code_profile: 'p42' }],
      undefined,
      [],
      { p42: { k: '4', m: '2' } }
    );
    expect(pools[0].ec).toEqual({ k: 4, m: 2 });
    expect(pools[0].rawFactor).toBe(1.5);
  });

  it('parses device-class rules', () => {
    const r = parseCrushRules([
      { rule_id: 3, rule_name: 'ssd', type: 1, steps: [{ op: 'take', item: -2, item_name: 'default~ssd' }, { op: 'chooseleaf_firstn', num: 0, type: 'rack' }, { op: 'emit' }] },
    ]);
    expect(r[0]).toMatchObject({ root: 'default', deviceClass: 'ssd', failureDomain: 'rack' });
  });

  it('parses autoscale and pool stats', () => {
    const a = parseAutoscale(SAMPLE.autoscale);
    expect(a.find(x => x.pool === 'vm-pool')?.pgNumFinal).toBe(32);
    const s = parsePoolStats(SAMPLE.poolStats);
    expect(s.get(1)?.io).toBeDefined();
  });
});

describe('daemons and lists', () => {
  it('parses quorum with ciphers', () => {
    const q = parseQuorum(SAMPLE.quorum);
    expect(q.leader).toBe('a');
    expect(q.mons).toHaveLength(3);
    expect(q.mons.every(m => m.inQuorum)).toBe(true);
    expect(q.allowedCiphers).toEqual(['aes', 'aes256k']);
    expect(q.serviceCipher).toBe('aes256k');
  });

  it('shortens versions', () => {
    expect(shortVersion('ceph version 20.2.4 (7f793731f1b39eb4f465e960113d2363c311b964) tentacle (stable - RelWithDebInfo)')).toBe('20.2.4 tentacle');
    expect(parseVersions(SAMPLE.versions).overall).toEqual({ '20.2.4 tentacle': 7 });
  });

  it('parses PGs, crashes, logs and config', () => {
    const pgs = parsePgBrief(SAMPLE.pgBrief);
    expect(pgs[0]).toMatchObject({ pool: 1, state: 'active+clean' });
    expect(pgs[0].acting).toHaveLength(3);
    const c = parseCrashes([
      { crash_id: 'a', entity_name: 'osd.1', timestamp: '2026-11-20T10:00:00.000000Z' },
      { crash_id: 'b', entity_name: 'mon.a', timestamp: '2026-11-21T10:00:00.000000Z', archived: '2026-11-21 11:00' },
    ]);
    expect(c.map(x => x.id)).toEqual(['b', 'a']);
    expect(c[0].archived).toBe(true);
    const log = parseLog([
      { name: 'mon.a', stamp: '2026-11-23T02:44:00.92Z', seq: 1, channel: 'cluster', priority: '[WRN]', message: 'x' },
      { name: 'mon.a', stamp: '2026-11-23T02:45:00.92Z', seq: 2, channel: 'cluster', priority: '[INF]', message: 'y' },
    ]);
    expect(log[0].message).toBe('y');
    expect(log[1].priority).toBe('WRN');
    expect(parseConfig(SAMPLE.config)[0]).toMatchObject({ section: 'global', name: 'log_to_file' });
  });
});
