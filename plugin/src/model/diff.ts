/*
 * A small line diff (longest common subsequence) for previewing changes to
 * Kubernetes objects as YAML. Inputs are a few hundred lines at most.
 */

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.replace(/\n$/, '').split('\n') : [];
  const b = after ? after.replace(/\n$/, '').split('\n') : [];
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return [...a.map(text => ({ kind: 'del' as const, text })), ...b.map(text => ({ kind: 'add' as const, text }))];
  }
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'add', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/** Keeps changed lines with `context` unchanged lines around them; gaps become a "…" line. */
export function withContext(lines: DiffLine[], context = 3): (DiffLine | { kind: 'gap'; text: string })[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | { kind: 'gap'; text: string })[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ kind: 'gap', text: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ kind: 'gap', text: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` });
  return out;
}

/** Strips server-managed fields before showing or diffing an object. */
export function cleanForDiff(o: any): any {
  if (!o) return o;
  const c = JSON.parse(JSON.stringify(o));
  if (c.metadata) {
    for (const k of ['managedFields', 'resourceVersion', 'uid', 'creationTimestamp', 'generation', 'selfLink']) delete c.metadata[k];
    if (c.metadata.annotations) {
      delete c.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
      if (!Object.keys(c.metadata.annotations).length) delete c.metadata.annotations;
    }
  }
  delete c.status;
  return c;
}
