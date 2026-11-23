import { deepEqual, jsonPatch } from './patch';

describe('jsonPatch', () => {
  it('tests and replaces changed leaves only', () => {
    const before = { spec: { a: 1, b: { c: 2 }, keep: [1, 2] }, metadata: { name: 'x' } };
    const after = { spec: { a: 1, b: { c: 3 }, keep: [1, 2] }, metadata: { name: 'x' } };
    expect(jsonPatch(before, after)).toEqual([
      { op: 'test', path: '/spec/b/c', value: 2 },
      { op: 'replace', path: '/spec/b/c', value: 3 },
    ]);
  });

  it('adds and removes keys, escaping / and ~', () => {
    const ops = jsonPatch({ spec: { 'a/b': 1, gone: true } }, { spec: { 'a/b': 1, 'x~y': { policy: 'mute' } } });
    expect(ops).toEqual([
      { op: 'test', path: '/spec/gone', value: true },
      { op: 'remove', path: '/spec/gone' },
      { op: 'add', path: '/spec/x~0y', value: { policy: 'mute' } },
    ]);
  });

  it('replaces arrays as a whole', () => {
    const ops = jsonPatch({ spec: { nodes: [{ name: 'a' }] } }, { spec: { nodes: [{ name: 'a' }, { name: 'b' }] } });
    expect(ops[0]).toEqual({ op: 'test', path: '/spec/nodes', value: [{ name: 'a' }] });
    expect(ops[1]).toMatchObject({ op: 'replace', path: '/spec/nodes' });
  });

  it('adds a missing section and returns nothing when equal', () => {
    expect(jsonPatch({ spec: {} }, { spec: { healthCheck: { x: 1 } } })).toEqual([{ op: 'add', path: '/spec/healthCheck', value: { x: 1 } }]);
    expect(jsonPatch({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
});
