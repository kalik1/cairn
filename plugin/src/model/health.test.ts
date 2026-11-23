import { SAMPLE } from './fixtures.sample';
import { checkInfo, cliText, docsUrl, HEALTH_CATALOG, muteCommand, unmuteCommand, verdict } from './health';
import { parseHealth, parseStatus } from './parse';
import { zeroCounts } from './pg';
import { ClusterStatus } from './types';

const base = (): ClusterStatus => {
  const s = parseStatus(SAMPLE.status);
  return { ...s, recovery: { ...s.recovery } };
};

describe('health catalog', () => {
  it('covers the common codes', () => {
    expect(Object.keys(HEALTH_CATALOG).length).toBeGreaterThanOrEqual(40);
    for (const code of ['OSD_DOWN', 'PG_DEGRADED', 'MON_DOWN', 'MGR_DOWN', 'POOL_FULL', 'MDS_ALL_DOWN', 'RECENT_CRASH', 'SLOW_OPS', 'DEVICE_HEALTH', 'OBJECT_UNFOUND', 'TOO_FEW_OSDS', 'TOO_MANY_PGS', 'AUTH_INSECURE_KEYS_ALLOWED']) {
      expect(HEALTH_CATALOG[code]).toBeDefined();
    }
    for (const [code, info] of Object.entries(HEALTH_CATALOG)) {
      expect(info.title, code).toBeTruthy();
      expect(info.todo.length, code).toBeGreaterThan(0);
    }
  });

  it('builds docs links from the code', () => {
    expect(docsUrl('OSD_DOWN')).toBe('https://docs.ceph.com/en/latest/rados/operations/health-checks/#osd-down');
    expect(docsUrl('AUTH_INSECURE_KEYS_CREATABLE')).toMatch(/#auth-insecure-keys-creatable$/);
    expect(docsUrl('OSD_RACK_DOWN')).toMatch(/#osd-crush-type-down$/);
    expect(docsUrl('MDS_ALL_DOWN')).toMatch(/cephfs\/health-messages/);
  });

  it('links the cephx checks to the Security view', () => {
    expect(checkInfo('AUTH_INSECURE_KEYS_ALLOWED').link?.view).toBe('security');
    expect(checkInfo('AUTH_INSECURE_SERVICE_KEY_TYPE').noMute).toBeTruthy();
  });

  it('handles CRUSH-type families and unknown codes', () => {
    expect(checkInfo('OSD_RACK_DOWN').title).toBe('Every OSD of a rack is down');
    const u = checkInfo('POOL_SOMETHING_NEW', { summary: 'Something new' });
    expect(u.known).toBe(false);
    expect(u.title).toBe('Something new');
    expect(u.link?.view).toBe('pools');
  });
});

describe('verdict', () => {
  it('sample: data safe, warnings need attention', () => {
    const s = base();
    const v = verdict(s, parseHealth(SAMPLE.health));
    expect(v.tone).toBe('warn');
    expect(v.title).toBe('Data is safe. 2 warnings need attention');
  });

  it('all clean and healthy', () => {
    const s = base();
    const v = verdict(s, { status: 'HEALTH_OK', checks: [], mutes: [] });
    expect(v).toMatchObject({ tone: 'ok', title: 'All data is safe and fully replicated' });
  });

  it('muted checks do not count', () => {
    const h = parseHealth(SAMPLE.health);
    h.checks = h.checks.map(c => ({ ...c, muted: true }));
    const v = verdict(base(), h);
    expect(v.tone).toBe('ok');
    expect(v.detail).toMatch(/2 muted checks/);
  });

  it('inactive PGs mean unavailable data', () => {
    const c = zeroCounts();
    c.clean = 30;
    c.inactive = 2;
    expect(verdict(base(), null, c)).toMatchObject({ tone: 'err', title: 'Some data is unavailable' });
  });

  it('inactive PGs of a pool created minutes ago are not unavailable data', () => {
    const c = zeroCounts();
    c.clean = 30;
    c.inactive = 8;
    expect(verdict(base(), null, c, 8)).toMatchObject({ tone: 'move', title: 'All data is safe; new placement groups are being created' });
    expect(verdict(base(), null, c, 3).title).toBe('Some data is unavailable');
  });

  it('degraded data, recovering or not', () => {
    const s = base();
    const c = zeroCounts();
    c.degraded = 3;
    c.clean = 30;
    s.recovery.degradedObjects = 100;
    s.recovery.degradedRatio = 0.02;
    expect(verdict(s, null, c).title).toBe('Some data is not fully replicated');
    s.recovery.objectsPerSec = 5;
    const v = verdict(s, null, c);
    expect(v.title).toBe('Some data is not fully replicated: recovering…');
    expect(v.detail).toMatch(/2\.0% of object copies/);
  });

  it('unfound and damaged come before degraded', () => {
    const s = base();
    s.recovery.unfoundObjects = 1;
    expect(verdict(s, null, zeroCounts()).title).toBe('Some objects cannot be found');
    const s2 = base();
    const c = zeroCounts();
    c.damaged = 1;
    c.degraded = 1;
    expect(verdict(s2, null, c).title).toBe('Some copies disagree');
  });

  it('full OSDs block writes', () => {
    const v = verdict(base(), { status: 'HEALTH_ERR', checks: [{ code: 'OSD_FULL', severity: 'HEALTH_ERR', summary: '1 full osd(s)', count: 1, details: [], muted: false }], mutes: [] });
    expect(v).toMatchObject({ tone: 'err', title: 'Data is safe, but writes are blocked' });
  });

  it('moving data is safe', () => {
    const s = base();
    const c = zeroCounts();
    c.moving = 4;
    s.recovery.misplacedObjects = 50;
    s.recovery.misplacedRatio = 0.01;
    const v = verdict(s, { status: 'HEALTH_WARN', checks: [{ code: 'OBJECT_MISPLACED', severity: 'HEALTH_WARN', summary: 'x', count: 1, details: [], muted: false }], mutes: [] }, c);
    expect(v.tone).toBe('move');
    expect(v.detail).toMatch(/1 warning needs attention/);
  });

  it('one error', () => {
    const v = verdict(base(), { status: 'HEALTH_ERR', checks: [{ code: 'MON_DISK_CRIT', severity: 'HEALTH_ERR', summary: 'x', count: 1, details: [], muted: false }], mutes: [] });
    expect(v).toMatchObject({ tone: 'err', title: 'Data is safe. 1 error needs attention' });
  });
});

describe('mute commands', () => {
  it('builds health mute and unmute', () => {
    expect(muteCommand('AUTH_INSECURE_KEYS_CREATABLE', '1h', false)).toEqual({ prefix: 'health mute', code: 'AUTH_INSECURE_KEYS_CREATABLE', ttl: '1h' });
    expect(muteCommand('X_Y', '', true)).toEqual({ prefix: 'health mute', code: 'X_Y', sticky: true });
    expect(unmuteCommand('X_Y')).toEqual({ prefix: 'health unmute', code: 'X_Y' });
  });

  it('prints commands like the CLI', () => {
    expect(cliText(muteCommand('X_Y', '1d', true))).toBe('ceph health mute X_Y 1d --sticky');
    expect(cliText({ prefix: 'osd set-group', flags: 'noout', who: ['host-a'] })).toBe('ceph osd set-group noout host-a');
  });
});
