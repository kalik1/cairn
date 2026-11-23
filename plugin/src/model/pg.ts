/*
 * Placement-group states, in words a storage admin acts on. Ceph prints a
 * PG state as flags joined by "+" ("active+undersized+degraded+backfilling");
 * Cairn folds them into six categories, from worst to best:
 *
 *   inactive   down, incomplete, stale, unknown, peered (or otherwise not
 *              active and not peering): clients cannot read or write it
 *   damaged    inconsistent copies, unfound objects, failed repair
 *   degraded   fewer copies than the pool wants (degraded, undersized)
 *   moving     recovering, backfilling, remapped, peering: data is moving
 *              but every object has its copies
 *   scrubbing  being checked (scrub, deep scrub, repair)
 *   clean      active+clean (snap trimming counts as clean)
 */

import { StateTone } from '../ui/tokens';
import { PgBrief, PgStateCount, ProgressEvent } from './types';

export type PgCategory = 'inactive' | 'damaged' | 'degraded' | 'moving' | 'scrubbing' | 'clean';

/** Worst first. */
export const PG_CATEGORIES: PgCategory[] = ['inactive', 'damaged', 'degraded', 'moving', 'scrubbing', 'clean'];

export const PG_CATEGORY_INFO: Record<PgCategory, { label: string; tone: StateTone; help: string }> = {
  inactive: {
    label: 'Inactive',
    tone: 'err',
    help: 'Down, incomplete, stale or unknown: clients cannot read or write the objects in these placement groups.',
  },
  damaged: {
    label: 'Damaged',
    tone: 'err',
    help: 'Inconsistent copies or unfound objects: a scrub found copies that disagree, or Ceph cannot find an object.',
  },
  degraded: {
    label: 'Degraded',
    tone: 'warn',
    help: 'Fewer copies than the pool wants (degraded or undersized). Data is readable; one more failure may make it unavailable.',
  },
  moving: {
    label: 'Moving',
    tone: 'move',
    help: 'Recovering, backfilling, remapped or peering: Ceph is moving copies. Every object still has its copies.',
  },
  scrubbing: { label: 'Scrubbing', tone: 'move', help: 'Being checked: Ceph compares the copies (scrub) or reads every byte (deep scrub).' },
  clean: { label: 'Clean', tone: 'ok', help: 'Active and clean: every object has all its copies where CRUSH wants them.' },
};

const INACTIVE = ['down', 'incomplete', 'stale', 'unknown'];
const TRANSIENT = ['peering', 'activating', 'creating', 'premerge', 'repair'];
const DAMAGED = ['inconsistent', 'snaptrim_error', 'recovery_unfound', 'backfill_unfound', 'failed_repair', 'damaged'];
const DEGRADED = ['degraded', 'undersized'];
const MOVING = [
  'recovering',
  'recovery_wait',
  'recovery_toofull',
  'backfilling',
  'backfill_wait',
  'backfill_toofull',
  'remapped',
  'forced_recovery',
  'forced_backfill',
  'laggy',
  'wait',
];
const SCRUB = ['scrubbing', 'deep', 'repair', 'scrub_wait'];

export function pgFlags(state: string): string[] {
  return state
    .split('+')
    .map(s => s.trim())
    .filter(Boolean);
}

/** The category of one PG state string. */
export function pgCategory(state: string): PgCategory {
  const f = new Set(pgFlags(state));
  if (f.size === 0 || INACTIVE.some(s => f.has(s))) return 'inactive';
  if (DAMAGED.some(s => f.has(s))) return 'damaged';
  if (!f.has('active')) return TRANSIENT.some(s => f.has(s)) ? 'moving' : 'inactive';
  if (DEGRADED.some(s => f.has(s))) return 'degraded';
  if (MOVING.some(s => f.has(s))) return 'moving';
  if (SCRUB.some(s => f.has(s))) return 'scrubbing';
  if (!f.has('clean')) return 'moving';
  return 'clean';
}

export type PgCounts = Record<PgCategory, number>;

export const zeroCounts = (): PgCounts => ({ inactive: 0, damaged: 0, degraded: 0, moving: 0, scrubbing: 0, clean: 0 });

export function worstCategory(c: PgCounts): PgCategory {
  return PG_CATEGORIES.find(k => c[k] > 0) ?? 'clean';
}

/** "1.1f" → 31 (the PG's sequence in its pool). */
export function pgSeq(pgid: string): number {
  const i = pgid.indexOf('.');
  const n = parseInt(i >= 0 ? pgid.slice(i + 1) : pgid, 16);
  return isFinite(n) ? n : 0;
}

export interface PoolPgs {
  pool: number;
  pgs: (PgBrief & { category: PgCategory })[];
  counts: PgCounts;
}

export interface PgSummary {
  total: number;
  counts: PgCounts;
  worst: PgCategory;
  pools: PoolPgs[];
}

/** Every PG categorised and grouped by pool (pools by id, PGs by sequence). */
export function summarizePgs(pgs: PgBrief[]): PgSummary {
  const counts = zeroCounts();
  const byPool = new Map<number, PoolPgs>();
  for (const p of pgs) {
    const category = pgCategory(p.state);
    counts[category]++;
    let g = byPool.get(p.pool);
    if (!g) {
      g = { pool: p.pool, pgs: [], counts: zeroCounts() };
      byPool.set(p.pool, g);
    }
    g.pgs.push({ ...p, category });
    g.counts[category]++;
  }
  const pools = [...byPool.values()].sort((a, b) => a.pool - b.pool);
  for (const g of pools) g.pgs.sort((a, b) => pgSeq(a.pgid) - pgSeq(b.pgid));
  return { total: pgs.length, counts, worst: worstCategory(counts), pools };
}

/** Category counts from "status" (pgs_by_state), when the PG list is not there. */
export function countsFromStates(byState: PgStateCount[]): PgCounts {
  const c = zeroCounts();
  for (const s of byState) c[pgCategory(s.state)] += s.count;
  return c;
}

/** PGs whose acting set holds this OSD, with its role. */
export function pgsOfOsd(pgs: PgBrief[], id: number): (PgBrief & { category: PgCategory; primaryHere: boolean; upHere: boolean })[] {
  return pgs
    .filter(p => p.acting.includes(id) || p.up.includes(id))
    .map(p => ({ ...p, category: pgCategory(p.state), primaryHere: p.primary === id, upHere: p.up.includes(id) }))
    .sort((a, b) => a.pool - b.pool || pgSeq(a.pgid) - pgSeq(b.pgid));
}

/**
 * Time left for a progress event, from how far it got since it started
 * (null when it is too early to tell, or Ceph gave no start time).
 */
export function progressEta(e: ProgressEvent, now = Date.now()): number | null {
  if (!e.startedAt || e.progress <= 0.02 || e.progress >= 1) return null;
  const elapsed = (now - e.startedAt) / 1000;
  if (elapsed <= 0) return null;
  return (elapsed * (1 - e.progress)) / e.progress;
}

/** Seconds to recover `objects` at `perSec` objects per second (null when idle). */
export function recoveryEta(objects: number, perSec: number): number | null {
  if (!(objects > 0) || !(perSec > 0)) return null;
  return objects / perSec;
}
