/*
 * Kubernetes events of the Rook namespace, for the Configuration view:
 * one row per event (core/v1 or events.k8s.io shapes), warnings first, then
 * the most recent; filters by type and text.
 */

import { Obj } from './types';

export interface EventRow {
  key: string;
  type: 'Warning' | 'Normal' | string;
  reason: string;
  /** "Pod rook-ceph-osd-0-…" */
  objectKind: string;
  objectName: string;
  objectNs?: string;
  message: string;
  count: number;
  /** Last time it happened (ms). */
  last: number | null;
  first: number | null;
  /** Who reported it (kubelet, rook-ceph-operator…). */
  source: string;
}

const t = (v?: string | null) => {
  if (!v) return null;
  const x = Date.parse(v);
  return isNaN(x) ? null : x;
};

export function eventRow(e: Obj): EventRow {
  const io = e.involvedObject ?? e.regarding ?? {};
  const last = t(e.series?.lastObservedTime) ?? t(e.lastTimestamp) ?? t(e.eventTime) ?? t(e.metadata.creationTimestamp);
  const first = t(e.firstTimestamp) ?? t(e.eventTime) ?? t(e.metadata.creationTimestamp);
  return {
    key: e.metadata.uid ?? `${e.metadata.namespace}/${e.metadata.name}`,
    type: e.type ?? 'Normal',
    reason: e.reason ?? '',
    objectKind: io.kind ?? '',
    objectName: io.name ?? '',
    objectNs: io.namespace,
    message: (e.message ?? e.note ?? '').trim(),
    count: e.series?.count ?? e.count ?? e.deprecatedCount ?? 1,
    last,
    first,
    source: e.source?.component ?? e.reportingComponent ?? e.reportingController ?? '',
  };
}

/** Warnings first, then the most recent first. */
export function sortEvents(rows: EventRow[]): EventRow[] {
  return [...rows].sort((a, b) => {
    const w = (b.type === 'Warning' ? 1 : 0) - (a.type === 'Warning' ? 1 : 0);
    return w || (b.last ?? 0) - (a.last ?? 0) || a.key.localeCompare(b.key);
  });
}

export function eventRows(events: Obj[]): EventRow[] {
  return sortEvents(events.map(eventRow));
}

export function filterEvents(rows: EventRow[], f: { type?: string; q?: string; sinceMs?: number; now?: number }): EventRow[] {
  const words = (f.q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const now = f.now ?? Date.now();
  return rows.filter(r => {
    if (f.type && r.type !== f.type) return false;
    if (f.sinceMs && (r.last ?? 0) < now - f.sinceMs) return false;
    if (!words.length) return true;
    const hay = `${r.reason} ${r.objectKind} ${r.objectName} ${r.message} ${r.source}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

/** Warnings, grouped by reason, for the summary line. */
export function warningReasons(rows: EventRow[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) if (r.type === 'Warning') m.set(r.reason, (m.get(r.reason) ?? 0) + r.count);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
