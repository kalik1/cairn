import { cleanForDiff, diffLines, withContext } from './diff';

describe('diff', () => {
  it('finds added and removed lines', () => {
    const d = diffLines('a\nb\nc\n', 'a\nc\nd\n');
    expect(d).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });
  it('handles creation and deletion', () => {
    expect(diffLines('', 'x').map(l => l.kind)).toEqual(['add']);
    expect(diffLines('x', '').map(l => l.kind)).toEqual(['del']);
  });
  it('folds unchanged lines', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l10', 'L10');
    const c = withContext(diffLines(before, after), 2);
    expect(c[0]).toEqual({ kind: 'gap', text: '8 unchanged lines' });
    expect(c.filter(l => l.kind === 'add')).toHaveLength(1);
    expect(c[c.length - 1].kind).toBe('gap');
  });
  it('cleans server fields', () => {
    const o = cleanForDiff({ metadata: { name: 'x', resourceVersion: '1', managedFields: [], annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}' } }, spec: { a: 1 }, status: { b: 2 } });
    expect(o).toEqual({ metadata: { name: 'x' }, spec: { a: 1 } });
  });
});
