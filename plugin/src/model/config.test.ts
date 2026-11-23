import {
  configCommandText,
  countByPriority,
  displayValue,
  filterLog,
  groupConfig,
  HIDDEN,
  managedBy,
  normName,
  parseAudit,
  parseConfigHelp,
  parseConfigLog,
  priorityOf,
  rookManaged,
  searchConfig,
  sensitive,
  valueProblem,
  whoOf,
  whoProblem,
  withCephConfig,
} from './config';
import { SAMPLE } from './fixtures.sample';
import { parseConfig, parseLog } from './parse';
import { Obj } from './types';

const entries = parseConfig(SAMPLE.config);

describe('config dump', () => {
  it('groups by section in Ceph order', () => {
    const extra = [
      ...entries,
      { section: 'osd', name: 'osd_memory_target', value: '4G', level: 'basic', runtime: true, mask: 'host:node1' },
      { section: 'client.test-cairn', name: 'debug_ms', value: '0/0', level: 'advanced', runtime: true, mask: '' },
      { section: 'osd.2', name: 'osd_max_backfills', value: '2', level: 'advanced', runtime: true, mask: '' },
    ];
    const g = groupConfig(extra);
    expect(g.map(x => x.who)).toEqual(['global', 'mon', 'mgr', 'osd.2', 'osd/host:node1', 'client.test-cairn']);
    expect(g[0].entries.map(e => e.name)).toEqual(['log_to_file', 'mon_allow_pool_delete', 'mon_allow_pool_size_one', 'mon_cluster_log_file']);
    expect(whoOf({ section: 'osd', mask: 'class:ssd' })).toBe('osd/class:ssd');
  });

  it('searches names in any spelling, who and values', () => {
    expect(searchConfig(entries, 'pool delete').map(e => e.name)).toEqual(['mon_allow_pool_delete']);
    expect(searchConfig(entries, 'mon-allow-pool-size').map(e => e.name)).toEqual(['mon_allow_pool_size_one']);
    expect(searchConfig(entries, 'mon false').map(e => e.name)).toEqual(['auth_allow_insecure_global_id_reclaim']);
    // A hidden value is not searchable (it would leak through the filter).
    expect(searchConfig(entries, 'eyJhbGci')).toEqual([]);
    expect(searchConfig(entries, '')).toHaveLength(entries.length);
    expect(normName('osd max backfills')).toBe('osd_max_backfills');
  });

  it('hides values that may be secrets', () => {
    const mc = entries.find(e => e.name === 'mgr/dashboard/MULTICLUSTER_CONFIG')!;
    expect(sensitive(mc.name)).toBe(true);
    expect(displayValue(mc.name, mc.value)).toBe(HIDDEN);
    expect(sensitive('rgw_keystone_admin_password')).toBe(true);
    expect(sensitive('mgr/dashboard/server_port')).toBe(false);
    expect(sensitive('keyring')).toBe(false);
    expect(displayValue('x', '{"user":"a","token":"eyJ","nested":{"password":"p"}}')).toBe('{"user":"a","token":"…","nested":{"password":"…"}}');
    expect(displayValue('x', '{broken')).toBe('{broken');
    expect(displayValue('debug_ms', '0/0')).toBe('0/0');
  });
});

describe('Rook-managed settings', () => {
  const cluster: Obj = {
    metadata: { name: 'rook-ceph', namespace: 'rook-ceph' },
    spec: {
      cephConfig: { global: { 'osd pool default size': '3' }, 'osd.*': { osd_max_scrubs: '2' } },
      cephConfigFromSecret: { mgr: { 'mgr/dashboard/x': { name: 'sec', key: 'k' } } },
    },
  };
  const m = rookManaged(cluster);

  it('reads spec.cephConfig and cephConfigFromSecret in any spelling, plus Rook defaults', () => {
    expect(managedBy(m, 'global', 'osd_pool_default_size')).toMatchObject({ by: 'spec', value: '3', name: 'osd pool default size' });
    expect(managedBy(m, 'mgr', 'mgr/dashboard/x')).toMatchObject({ by: 'secret', secret: 'sec/k' });
    expect(managedBy(m, 'global', 'mon_allow_pool_delete')?.by).toBe('rook-default');
    expect(managedBy(m, 'osd', 'osd_max_scrubs')).toBeUndefined();
    expect(managedBy(rookManaged(null), 'mon', 'auth_allow_insecure_global_id_reclaim')?.by).toBe('rook-default');
  });

  it('edits spec.cephConfig keeping the spelling, and removes empty sections', () => {
    const set = withCephConfig(cluster, 'global', 'osd_pool_default_size', '2');
    expect(set.spec.cephConfig.global).toEqual({ 'osd pool default size': '2' });
    expect(cluster.spec.cephConfig.global['osd pool default size']).toBe('3');
    const add = withCephConfig(cluster, 'client.test-cairn', 'debug_ms', '0/0');
    expect(add.spec.cephConfig['client.test-cairn']).toEqual({ debug_ms: '0/0' });
    const rm = withCephConfig(cluster, 'global', 'osd pool default size', null);
    expect(rm.spec.cephConfig.global).toBeUndefined();
    expect(rm.spec.cephConfig['osd.*']).toBeDefined();
    const empty = withCephConfig({ metadata: { name: 'c' }, spec: { cephConfig: { global: { a: '1' } } } }, 'global', 'a', null);
    expect(empty.spec.cephConfig).toBeUndefined();
  });
});

describe('commands and validation', () => {
  it('prints the exact command', () => {
    expect(configCommandText('set', 'client.test-cairn', 'debug_ms', '0/0')).toBe('ceph config set client.test-cairn debug_ms 0/0');
    expect(configCommandText('rm', 'osd/host:node1', 'osd_memory_target')).toBe('ceph config rm osd/host:node1 osd_memory_target');
    expect(configCommandText('set', 'global', 'x', 'a b')).toBe("ceph config set global x 'a b'");
    expect(configCommandText('set', 'global', 'x', '')).toBe("ceph config set global x ''");
  });

  it('checks who', () => {
    expect(whoProblem('global')).toBeNull();
    expect(whoProblem('osd')).toBeNull();
    expect(whoProblem('osd.3')).toBeNull();
    expect(whoProblem('client.test-cairn')).toBeNull();
    expect(whoProblem('client.rgw.my.store.a')).toBeNull();
    expect(whoProblem('osd/host:kube-worker-x')).toBeNull();
    expect(whoProblem('osd/class:ssd')).toBeNull();
    expect(whoProblem('')).toMatch(/Say who/);
    expect(whoProblem('daemon.3')).toMatch(/Starts with/);
    expect(whoProblem('global.x')).toMatch(/no daemon/);
    expect(whoProblem('osd/bogus')).toMatch(/mask/);
  });

  it('parses config help and checks values against it', () => {
    const h = parseConfigHelp({
      name: 'osd_max_backfills',
      type: 'uint',
      level: 'advanced',
      desc: 'Maximum number of concurrent local and remote backfills or recoveries per OSD',
      default: 1,
      min: '',
      max: '',
      services: ['osd'],
      see_also: ['osd_mclock_override_recovery_settings'],
      can_update_at_runtime: true,
      flags: ['runtime'],
    })!;
    expect(h).toMatchObject({ name: 'osd_max_backfills', type: 'uint', default: '1', runtime: true, services: ['osd'] });
    expect(valueProblem('2', h)).toBeNull();
    expect(valueProblem('-1', h)).toMatch(/Zero/);
    expect(valueProblem('1.5', h)).toMatch(/whole/);
    expect(valueProblem('x', h)).toMatch(/number/);
    const e = parseConfigHelp({ name: 'm', type: 'str', enum_values: ['off', 'warn', 'on'] })!;
    expect(valueProblem('on', e)).toBeNull();
    expect(valueProblem('maybe', e)).toMatch(/One of/);
    const r = parseConfigHelp({ name: 't', type: 'uint', min: 1, max: 10 })!;
    expect(valueProblem('0', r)).toMatch(/At least 1/);
    expect(valueProblem('11', r)).toMatch(/At most 10/);
    expect(valueProblem('4G', parseConfigHelp({ name: 's', type: 'size' }))).toBeNull();
    expect(valueProblem('yes', parseConfigHelp({ name: 'b', type: 'bool' }))).toBeNull();
    expect(valueProblem('0/0', parseConfigHelp({ name: 'debug_ms', type: 'str' }))).toBeNull();
    expect(parseConfigHelp(null)).toBeNull();
  });

  it('reads config log with secrets hidden', () => {
    const log = parseConfigLog([
      { version: 8, timestamp: '2026-11-23T02:27:57.181467+0000', name: '', changes: [{ name: 'mgr/mgr/dashboard/MULTICLUSTER_CONFIG', new_value: '{"token":"eyJ"}' }] },
      { version: 9, timestamp: '2026-11-23T02:28:16.786766+0000', name: '', changes: [{ name: 'client.test-cairn/debug_ms', previous_value: '1/1', new_value: '0/0' }] },
    ]);
    expect(log.map(l => l.version)).toEqual([9, 8]);
    expect(log[0].changes[0]).toEqual({ name: 'client.test-cairn/debug_ms', previous: '1/1', value: '0/0' });
    expect(log[1].changes[0].value).toBe(HIDDEN);
    expect(log[0].time).toBe(Date.parse('2026-11-23T02:28:16.786Z'));
  });
});

describe('logs', () => {
  const raw = [
    { name: 'mon.a', stamp: '2026-11-23T03:01:17.111051+0000', seq: 1, channel: 'cluster', priority: '[INF]', message: 'osd.1 marked itself up' },
    { name: 'mon.a', stamp: '2026-11-23T03:01:18.111051+0000', seq: 2, channel: 'cluster', priority: '[WRN]', message: 'Health check failed: 1 osds down (OSD_DOWN)' },
    { name: 'osd.2', stamp: '2026-11-23T03:01:19.111051+0000', seq: 3, channel: 'cluster', priority: '[DBG]', message: '5.1b scrub ok' },
    { name: 'mon.b', stamp: '2026-11-23T03:01:20.111051+0000', seq: 4, channel: 'cluster', priority: '[ERR]', message: 'Health check failed: Reduced data availability' },
  ];
  const log = parseLog(raw);

  it('filters by priority and words', () => {
    expect(filterLog(log, { priorities: ['WRN', 'ERR'] }).map(e => e.seq)).toEqual([4, 2]);
    expect(filterLog(log, { q: 'health osd_down' }).map(e => e.seq)).toEqual([2]);
    expect(filterLog(log, { q: 'osd.2' }).map(e => e.seq)).toEqual([3]);
    expect(filterLog(log, {})).toHaveLength(4);
    expect(countByPriority(log)).toEqual({ INF: 1, WRN: 1, DBG: 1, ERR: 1 });
    expect(priorityOf('[WRN]')).toMatchObject({ word: 'Warning', tone: 'warn' });
    expect(priorityOf('XYZ').word).toBe('XYZ');
  });

  it('splits audit messages', () => {
    // From a real audit channel.
    const a = parseAudit(
      `from='mgr.4265 192.0.2.101:0/1003' entity='mgr.a' cmd={"prefix": "osd pool set", "pool": ".rgw.root", "var": "pgp_num_actual", "val": "32"} : dispatch`
    );
    expect(a).toEqual({ entity: 'mgr.a', from: 'mgr.4265 192.0.2.101:0/1003', prefix: 'osd pool set', args: 'pool=.rgw.root var=pgp_num_actual val=32', phase: 'dispatch' });
    const b = parseAudit(`from='client.? 192.0.2.41:0/1' entity='client.admin' cmd=[{"prefix":"config set","who":"client.test-cairn","name":"debug_ms","value":"0/0"}]: finished`);
    expect(b).toMatchObject({ entity: 'client.admin', prefix: 'config set', phase: 'finished', args: 'who=client.test-cairn name=debug_ms value=0/0' });
    // The finished line quotes the command.
    const c = parseAudit(
      `from='mgr.4265 192.0.2.101:0/1003' entity='mgr.a' cmd='[{"prefix": "osd pool set", "pool": "test-fs-metadata", "var": "pgp_num_actual", "val": "16"}]': finished`
    );
    expect(c).toMatchObject({ entity: 'mgr.a', prefix: 'osd pool set', phase: 'finished', args: 'pool=test-fs-metadata var=pgp_num_actual val=16' });
    expect(parseAudit('plain message')).toMatchObject({ entity: '', prefix: '' });
  });
});
