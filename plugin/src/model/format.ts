/*
 * Number and time formatting. Bytes are IEC (KiB, MiB, GiB, TiB) like
 * Ceph prints them; rates per second; latencies in ms.
 */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];

export function bytes(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const neg = n < 0;
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const d = digits ?? (i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2);
  return `${neg ? '-' : ''}${v.toFixed(d)} ${UNITS[i]}`;
}

export function rate(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return `${bytes(n)}/s`;
}

/** Operations per second. */
export function ops(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k op/s`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k op/s`;
  return `${n >= 10 ? Math.round(n) : Number(n.toFixed(1))} op/s`;
}

export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-US');
}

export function pct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !isFinite(ratio)) return '—';
  const v = ratio * 100;
  if (v > 0 && v < 0.1) return '<0.1%';
  return `${v.toFixed(v >= 10 ? Math.min(digits, 1) : digits)}%`;
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)} s`;
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ms`;
}

/** A duration in seconds: "45 s", "12 min", "3 h 10 min", "4 d 2 h". */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** Parses Ceph times ("2026-11-23T01:16:30.570445+0000", "...Z", epoch seconds) to ms since epoch. */
export function cephTime(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  // "+0000" → "+00:00"; Ceph's fsmap btime uses "T23:42:05:508841" (colon before micros).
  let s = v.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  s = s.replace(/T(\d{2}:\d{2}:\d{2}):(\d+)/, 'T$1.$2');
  s = s.replace(/\.(\d{3})\d+/, '.$1');
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

/** "3 h ago" from a time in ms. */
export function ago(t: number | null | undefined, now = Date.now()): string {
  if (t === null || t === undefined) return '—';
  const s = (now - t) / 1000;
  if (s < 5) return 'just now';
  return `${duration(s)} ago`;
}

/** Parses sizes typed by people: "10G", "10 GiB", "512M", "1.5T", plain bytes. */
export function parseSize(input: string): number | null {
  const m = input.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgtpe]?)(i?b?)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const p = 'BKMGTPE'.indexOf((m[2] || 'B').toUpperCase());
  const v = n * Math.pow(1024, p);
  return isFinite(v) ? Math.round(v) : null;
}

/** "1 OSD", "3 OSDs". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
