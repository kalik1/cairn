/*
 * Time series kept in memory while Cairn is open: one ring buffer per
 * series key ("io.readBps", "pool.1.writeOps", "osd.3.commitMs"…), filled
 * by every status poll. Survives route changes (module level), not
 * reloads.
 */

export interface Point {
  t: number;
  v: number;
}

export class SeriesStore {
  private data = new Map<string, Point[]>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private max = 360) {}

  push(key: string, t: number, v: number) {
    if (!isFinite(v)) return;
    let s = this.data.get(key);
    if (!s) {
      s = [];
      this.data.set(key, s);
    }
    const last = s[s.length - 1];
    if (last && t <= last.t) return;
    s.push({ t, v });
    if (s.length > this.max) s.splice(0, s.length - this.max);
  }

  /** Several values at the same time, then one notification. */
  pushAll(t: number, values: Record<string, number | undefined>) {
    for (const [k, v] of Object.entries(values)) if (v !== undefined) this.push(k, t, v);
    this.version++;
    this.listeners.forEach(l => l());
  }

  get(key: string): Point[] {
    return this.data.get(key) ?? [];
  }

  /** Points of several series aligned on time, for charts: [{t, a, b}]. */
  table(keys: Record<string, string>, sinceMs?: number): Record<string, number>[] {
    const rows = new Map<number, Record<string, number>>();
    for (const [name, key] of Object.entries(keys)) {
      for (const p of this.get(key)) {
        if (sinceMs && p.t < sinceMs) continue;
        const r = rows.get(p.t) ?? { t: p.t };
        r[name] = p.v;
        rows.set(p.t, r);
      }
    }
    return [...rows.values()].sort((a, b) => a.t - b.t);
  }

  keys(prefix = ''): string[] {
    return [...this.data.keys()].filter(k => k.startsWith(prefix));
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getVersion = () => this.version;

  clear() {
    this.data.clear();
    this.version++;
    this.listeners.forEach(l => l());
  }
}

/** Per-second rate from two samples of a monotonically growing counter (null on reset). */
export function counterRate(prev: { t: number; v: number } | undefined, cur: { t: number; v: number }): number | null {
  if (!prev || cur.t <= prev.t) return null;
  const dv = cur.v - prev.v;
  if (dv < 0) return null;
  return dv / ((cur.t - prev.t) / 1000);
}
