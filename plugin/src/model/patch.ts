/*
 * JSON Patch (RFC 6902) from an object before and after an edit, with a
 * "test" before every replace and remove: the API server applies the change
 * only if the edited fields still hold the values the user saw. Unlike a
 * PUT with the resourceVersion, an unrelated write meanwhile (Rook updates
 * a CephCluster's status every minute) does not make it fail; a concurrent
 * change to the same fields does.
 */

export type PatchOp =
  | { op: 'test' | 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string };

const esc = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

export function jsonPatch(before: unknown, after: unknown, base = ''): PatchOp[] {
  if (deepEqual(before, after)) return [];
  if (isObj(before) && isObj(after)) {
    const ops: PatchOp[] = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const p = `${base}/${esc(k)}`;
      const inB = Object.prototype.hasOwnProperty.call(before, k);
      const inA = Object.prototype.hasOwnProperty.call(after, k);
      if (inB && !inA) ops.push({ op: 'test', path: p, value: before[k] }, { op: 'remove', path: p });
      else if (!inB && inA) ops.push({ op: 'add', path: p, value: after[k] });
      else ops.push(...jsonPatch(before[k], after[k], p));
    }
    return ops;
  }
  return [
    { op: 'test', path: base, value: before },
    { op: 'replace', path: base, value: after },
  ];
}
