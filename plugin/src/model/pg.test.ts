import { SAMPLE } from './fixtures.sample';
import { parsePgBrief } from './parse';
import { countsFromStates, pgCategory, pgSeq, pgsOfOsd, progressEta, recoveryEta, summarizePgs, worstCategory, zeroCounts } from './pg';

describe('pg categories', () => {
  it.each([
    ['active+clean', 'clean'],
    ['active+clean+snaptrim', 'clean'],
    ['active+clean+scrubbing', 'scrubbing'],
    ['active+clean+scrubbing+deep', 'scrubbing'],
    ['active+remapped+backfilling', 'moving'],
    ['active+recovery_wait', 'moving'],
    ['peering', 'moving'],
    ['creating+peering', 'moving'],
    ['active+undersized', 'degraded'],
    ['active+undersized+degraded+remapped+backfilling', 'degraded'],
    ['active+recovering+degraded', 'degraded'],
    ['active+clean+inconsistent', 'damaged'],
    ['active+recovery_unfound+degraded', 'damaged'],
    ['down', 'inactive'],
    ['stale+active+clean', 'inactive'],
    ['incomplete', 'inactive'],
    ['unknown', 'inactive'],
    ['undersized+degraded+peered', 'inactive'],
    ['', 'inactive'],
    ['active', 'moving'],
  ])('%s is %s', (state, cat) => {
    expect(pgCategory(state)).toBe(cat);
  });

  it('summarizes the sample PGs by pool', () => {
    const pgs = parsePgBrief(SAMPLE.pgBrief);
    const s = summarizePgs(pgs);
    expect(s.total).toBe(pgs.length);
    expect(s.counts.clean).toBe(pgs.length);
    expect(s.worst).toBe('clean');
    expect(s.pools.map(p => p.pool)).toEqual([...new Set(pgs.map(p => p.pool))].sort((a, b) => a - b));
    const seqs = s.pools[0].pgs.map(p => pgSeq(p.pgid));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('finds the worst category', () => {
    const c = zeroCounts();
    c.clean = 10;
    c.scrubbing = 1;
    expect(worstCategory(c)).toBe('scrubbing');
    c.inactive = 1;
    expect(worstCategory(c)).toBe('inactive');
  });

  it('counts from pgs_by_state', () => {
    const c = countsFromStates([
      { state: 'active+clean', count: 30 },
      { state: 'active+undersized+degraded', count: 2 },
      { state: 'unknown', count: 1 },
    ]);
    expect(c).toMatchObject({ clean: 30, degraded: 2, inactive: 1 });
  });

  it('reads pg sequences in hex', () => {
    expect(pgSeq('1.1f')).toBe(31);
    expect(pgSeq('12.a')).toBe(10);
  });

  it('lists the PGs of an OSD', () => {
    const pgs = [
      { pgid: '1.0', pool: 1, state: 'active+clean', up: [0, 1, 2], acting: [0, 1, 2], primary: 0 },
      { pgid: '1.1', pool: 1, state: 'active+clean', up: [1, 2, 3], acting: [1, 2, 3], primary: 1 },
      { pgid: '2.0', pool: 2, state: 'active+remapped', up: [1, 0, 2], acting: [1, 3, 2], primary: 1 },
    ];
    const mine = pgsOfOsd(pgs, 0);
    expect(mine.map(p => p.pgid)).toEqual(['1.0', '2.0']);
    expect(mine[0].primaryHere).toBe(true);
    expect(mine[1]).toMatchObject({ primaryHere: false, upHere: true, category: 'moving' });
  });

  it('estimates time left', () => {
    expect(progressEta({ id: 'x', message: '', progress: 0.5, startedAt: 1000_000 }, 1000_000 + 60_000)).toBeCloseTo(60);
    expect(progressEta({ id: 'x', message: '', progress: 0.01, startedAt: 1000 }, 5000)).toBeNull();
    expect(progressEta({ id: 'x', message: '', progress: 0.5 })).toBeNull();
    expect(recoveryEta(1000, 50)).toBe(20);
    expect(recoveryEta(1000, 0)).toBeNull();
  });
});
