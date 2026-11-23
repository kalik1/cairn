import { counterRate, SeriesStore } from './history';

describe('SeriesStore', () => {
  it('keeps the last N points per series, in time order', () => {
    const s = new SeriesStore(3);
    for (let i = 1; i <= 5; i++) s.push('a', i * 1000, i);
    s.push('a', 4000, 99); // out of order: ignored
    expect(s.get('a').map(p => p.v)).toEqual([3, 4, 5]);
  });

  it('aligns series into a table and notifies', () => {
    const s = new SeriesStore();
    let n = 0;
    s.subscribe(() => n++);
    s.pushAll(1000, { r: 1, w: 2 });
    s.pushAll(2000, { r: 3, w: undefined });
    expect(s.table({ read: 'r', write: 'w' })).toEqual([
      { t: 1000, read: 1, write: 2 },
      { t: 2000, read: 3 },
    ]);
    expect(n).toBe(2);
    expect(s.keys('r')).toEqual(['r']);
  });

  it('computes counter rates and ignores resets', () => {
    expect(counterRate({ t: 0, v: 100 }, { t: 2000, v: 300 })).toBe(100);
    expect(counterRate({ t: 0, v: 300 }, { t: 2000, v: 100 })).toBeNull();
    expect(counterRate(undefined, { t: 2000, v: 100 })).toBeNull();
  });
});
