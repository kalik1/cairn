/*
 * OSDs in words and commands: state, fill against Ceph's ratios, the
 * cluster flags and what each one does, the answers of "osd ok-to-stop"
 * and "osd safe-to-destroy", and the maintenance plan (the exact commands
 * Cairn runs to take a host or an OSD down for work, and to finish).
 */

import type { StateTone } from '../ui/tokens';
import type { BridgeResult } from './exec';
import { Osd, OsdMapInfo } from './types';

/* ---------------------------------------------------------------- state */

export function osdTone(o: Pick<Osd, 'up' | 'in'>): StateTone {
  if (!o.up) return 'err';
  if (!o.in) return 'warn';
  return 'ok';
}

export function osdStateWord(o: Pick<Osd, 'up' | 'in'>): string {
  return `${o.up ? 'Up' : 'Down'}, ${o.in ? 'in' : 'out'}`;
}

export interface Ratios {
  nearFull: number;
  backfillFull: number;
  full: number;
}

export function ratiosOf(m: OsdMapInfo | null | undefined): Ratios {
  return { nearFull: m?.nearFullRatio ?? 0.85, backfillFull: m?.backfillFullRatio ?? 0.9, full: m?.fullRatio ?? 0.95 };
}

/** Cairn warns at 75% (before Ceph's near-full), Ceph's ratios after. */
export const EARLY_WARN_PCT = 75;

export function fillTone(utilPct: number, r: Ratios): StateTone {
  if (utilPct >= r.backfillFull * 100) return 'err';
  if (utilPct >= Math.min(EARLY_WARN_PCT, r.nearFull * 100)) return 'warn';
  return 'ok';
}

export function fillWord(utilPct: number, r: Ratios): string {
  if (utilPct >= r.full * 100) return 'Full: writes stop';
  if (utilPct >= r.backfillFull * 100) return 'Backfill-full: no data moves here';
  if (utilPct >= r.nearFull * 100) return 'Near full';
  if (utilPct >= EARLY_WARN_PCT) return 'Filling up';
  return 'Room to spare';
}

/** Where an OSD's data lives, from its metadata. */
export function backing(o: Osd): {
  node: string;
  device: string;
  path: string;
  deviceId: string;
  rotational: boolean | null;
  type: string;
  pod: string;
  podNamespace: string;
} {
  const m = o.meta;
  const device = m?.devices.join(', ') ?? '';
  const first = m?.devices[0] ?? '';
  return {
    node: m?.hostname ?? '',
    device,
    path: (first && m?.devicePaths[first]) || '',
    deviceId: (first && m?.deviceIds[first]) || '',
    rotational: m?.rotational ?? null,
    type: m ? `${m.objectstore || 'bluestore'}${m.bdevType ? ` on ${m.bdevType}` : ''}${m.dedicatedDb ? ', separate DB' : ''}${m.dedicatedWal ? ', separate WAL' : ''}` : '',
    pod: m?.podName ?? '',
    podNamespace: m?.podNamespace ?? '',
  };
}

/* ---------------------------------------------------------- cluster flags */

export interface FlagInfo {
  flag: string;
  label: string;
  /** What setting it does, in plain words. */
  meaning: string;
  /** When to use it. */
  when: string;
  /** Strong warning shown before setting. */
  danger?: string;
}

export const CLUSTER_FLAGS: FlagInfo[] = [
  {
    flag: 'noout',
    label: 'Do not mark OSDs out',
    meaning: 'Down OSDs stay in: Ceph waits for them instead of rebuilding their copies elsewhere.',
    when: 'Short planned work (node reboot, upgrade). Data stays degraded while OSDs are down.',
  },
  {
    flag: 'noin',
    label: 'Do not mark OSDs in',
    meaning: 'OSDs that start (new or returning) are not marked in, so no data moves to them.',
    when: 'Adding several OSDs and bringing them in together later.',
  },
  {
    flag: 'nodown',
    label: 'Do not mark OSDs down',
    meaning: 'Ceph ignores failure reports: an OSD that stops answering stays up, and I/O to it hangs.',
    when: 'Only against flapping OSDs (network trouble) for a short time.',
    danger: 'I/O to OSDs that really died will hang instead of failing over.',
  },
  {
    flag: 'noup',
    label: 'Do not mark OSDs up',
    meaning: 'OSDs that start stay down.',
    when: 'Keeping OSDs from rejoining while you investigate.',
  },
  {
    flag: 'norebalance',
    label: 'No rebalancing',
    meaning: 'Ceph does not move clean data to where CRUSH wants it; degraded data still recovers.',
    when: 'Changing CRUSH, weights or adding OSDs, to start the data movement later at once.',
  },
  {
    flag: 'norecover',
    label: 'No recovery',
    meaning: 'Ceph does not rebuild missing copies of degraded objects.',
    when: 'Rarely: to free disks and network for client I/O for a short time.',
    danger: 'Degraded data stays degraded: a further failure can make it unavailable or lose it.',
  },
  {
    flag: 'nobackfill',
    label: 'No backfill',
    meaning: 'Ceph does not copy whole placement groups to new OSDs.',
    when: 'Delaying data movement after adding or removing OSDs.',
  },
  {
    flag: 'noscrub',
    label: 'No scrubs',
    meaning: 'Light scrubs (comparing copies) stop.',
    when: 'During heavy load or recovery. Unset soon: problems in copies go unnoticed.',
  },
  {
    flag: 'nodeep-scrub',
    label: 'No deep scrubs',
    meaning: 'Deep scrubs (reading every byte of every copy) stop.',
    when: 'During heavy load or recovery. Unset soon: bit rot goes unnoticed.',
  },
  {
    flag: 'pause',
    label: 'Pause all I/O',
    meaning: 'Every client read and write stops (pauserd and pausewr).',
    when: 'Only for a full cluster shutdown or an emergency.',
    danger: 'Every client stops: virtual machines freeze, applications time out. Nothing reads or writes until you unset it.',
  },
];

export const FLAG_BY_NAME = new Map(CLUSTER_FLAGS.map(f => [f.flag, f]));

/** Flags as the OSD map lists them: "pauserd,pausewr" count as "pause". */
export function setFlags(m: OsdMapInfo | null | undefined): Set<string> {
  const s = new Set(m?.flags ?? []);
  if (s.has('pauserd') || s.has('pausewr')) s.add('pause');
  return s;
}

export function flagCommand(flag: string, on: boolean): Record<string, unknown> {
  return { prefix: on ? 'osd set' : 'osd unset', key: flag };
}

/* ------------------------------------------------------- per-OSD commands */

export const PER_OSD_FLAGS = ['noout', 'noin', 'noup', 'nodown'] as const;

const ids = (list: number[]) => list.map(String);

export const osdCmd = {
  out: (list: number[]) => ({ prefix: 'osd out', ids: ids(list) }),
  in: (list: number[]) => ({ prefix: 'osd in', ids: ids(list) }),
  reweight: (id: number, weight: number) => ({ prefix: 'osd reweight', id, weight }),
  addNoout: (list: number[]) => ({ prefix: 'osd add-noout', ids: ids(list) }),
  rmNoout: (list: number[]) => ({ prefix: 'osd rm-noout', ids: ids(list) }),
  scrub: (id: number) => ({ prefix: 'osd scrub', who: String(id) }),
  deepScrub: (id: number) => ({ prefix: 'osd deep-scrub', who: String(id) }),
  okToStop: (list: number[]) => ({ prefix: 'osd ok-to-stop', ids: ids(list) }),
  safeToDestroy: (list: number[]) => ({ prefix: 'osd safe-to-destroy', ids: ids(list) }),
  setGroup: (flag: string, who: string[]) => ({ prefix: 'osd set-group', flags: flag, who }),
  unsetGroup: (flag: string, who: string[]) => ({ prefix: 'osd unset-group', flags: flag, who }),
};

/** "osd ok-to-stop", "osd safe-to-destroy", "osd scrub" are manager commands; the rest are monitor commands. */
export const MGR_PREFIXES = new Set(['osd ok-to-stop', 'osd safe-to-destroy', 'osd scrub', 'osd deep-scrub', 'osd repair']);

/** A reweight value people typed: 0..1, or a percentage. */
export function parseReweight(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const pct = s.endsWith('%');
  const n = parseFloat(pct ? s.slice(0, -1) : s);
  if (!isFinite(n)) return null;
  const v = pct ? n / 100 : n;
  if (v < 0 || v > 1) return null;
  return Math.round(v * 10000) / 10000;
}

/* --------------------------------------------------------- safety checks */

export interface StopCheck {
  ok: boolean;
  /** Ceph's sentence. */
  message: string;
  okPgs: number;
  notOkPgs: number;
  /** PGs that would become inactive (data unavailable). */
  becomeInactive: string[];
  /** PGs that would run degraded (fewer copies). */
  becomeDegraded: string[];
  alreadyInactive: string[];
  unknown: string[];
}

/** "osd ok-to-stop": r 0 = ok, -EAGAIN (−11) or -EBUSY (−16) = not ok, with the same JSON. */
export function parseOkToStop(res: BridgeResult | undefined): StopCheck | null {
  if (!res) return null;
  const o: any = res.out && typeof res.out === 'object' ? res.out : {};
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const ok = res.r === 0 && o.ok_to_stop !== false;
  return {
    ok,
    message: (res.err || '').trim() || (ok ? 'Stopping them leaves every placement group active.' : 'Not safe to stop.'),
    okPgs: Number(o.num_ok_pgs ?? 0),
    notOkPgs: Number(o.num_not_ok_pgs ?? 0),
    becomeInactive: arr(o.bad_become_inactive),
    becomeDegraded: arr(o.ok_become_degraded),
    alreadyInactive: arr(o.bad_already_inactive),
    unknown: arr(o.unknown_pgs),
  };
}

export interface DestroyCheck {
  safe: boolean;
  message: string;
}

/** "osd safe-to-destroy": r 0 = safe (no data would be lost), else Ceph says why not. */
export function parseSafeToDestroy(res: BridgeResult | undefined): DestroyCheck | null {
  if (!res) return null;
  const safe = res.r === 0;
  const msg = (res.err || '').trim();
  return { safe, message: msg || (safe ? 'No data depends on it: it is safe to remove.' : 'Data still depends on it.') };
}

/* ----------------------------------------------------------- maintenance */

export interface PlanStep {
  /** What the step does, in words. */
  text: string;
  cmd: Record<string, unknown>;
}

export interface MaintenancePlan {
  start: PlanStep[];
  finish: PlanStep[];
  /** What the start does to the cluster. */
  consequences: string[];
}

/**
 * Taking OSDs down for work. On a host: noout on the CRUSH host bucket
 * (set-group), so OSDs added there meanwhile are covered too; otherwise
 * noout per OSD. Marking out is optional and starts moving data off.
 */
export function maintenancePlan(o: { osds: number[]; host?: string; markOut: boolean }): MaintenancePlan {
  const list = [...o.osds].sort((a, b) => a - b);
  const names = list.map(i => `osd.${i}`).join(', ');
  const one = list.length === 1 && !o.host;
  const start: PlanStep[] = [];
  const finish: PlanStep[] = [];
  if (o.host) {
    start.push({ text: `Keep the OSDs of ${o.host} in while they are down (noout on the host)`, cmd: osdCmd.setGroup('noout', [o.host]) });
  } else {
    start.push({ text: `Keep ${names} in while down (noout)`, cmd: osdCmd.addNoout(list) });
  }
  if (o.markOut) start.push({ text: `Mark ${names} out: Ceph moves their data to other OSDs`, cmd: osdCmd.out(list) });
  if (o.markOut) finish.push({ text: `Mark ${names} in again`, cmd: osdCmd.in(list) });
  if (o.host) finish.push({ text: `Let Ceph mark the OSDs of ${o.host} out again when they fail`, cmd: osdCmd.unsetGroup('noout', [o.host]) });
  else finish.push({ text: `Clear noout on ${names}`, cmd: osdCmd.rmNoout(list) });
  const consequences = [
    o.markOut
      ? `Ceph starts moving every placement group off ${names} now: disk and network load until it finishes. Wait until the data is fully replicated elsewhere before you stop anything.`
      : `Nothing moves now. When ${names} ${one ? 'stops, its' : 'stop, their'} placement groups run degraded (fewer copies) until ${one ? 'it returns' : 'they return'}; Ceph waits instead of rebuilding.`,
    'Stop the daemons (drain or reboot the node) only after this step; Kubernetes starts the OSD pods again when the node returns.',
    'When the work is done, run the finishing steps so Ceph heals on its own again.',
  ];
  return { start, finish, consequences };
}

/* ---------------------------------------------------------------- hosts */

export interface Shelf {
  host: string;
  node?: string;
  osds: Osd[];
  sizeBytes: number;
  usedBytes: number;
  utilization: number;
  up: number;
  in: number;
}

/** One shelf per CRUSH host, with its OSDs (OSDs outside any host on a last shelf). */
export function shelves(hosts: { name: string; node?: string; osds: number[]; sizeBytes: number; usedBytes: number; utilization: number }[], osds: Osd[]): Shelf[] {
  const byId = new Map(osds.map(o => [o.id, o]));
  const seen = new Set<number>();
  const out: Shelf[] = hosts.map(h => {
    const list = h.osds.map(i => byId.get(i)).filter((o): o is Osd => !!o);
    list.forEach(o => seen.add(o.id));
    return {
      host: h.name,
      node: h.node ?? list.find(o => o.meta?.hostname)?.meta?.hostname,
      osds: list,
      sizeBytes: h.sizeBytes,
      usedBytes: h.usedBytes,
      utilization: h.utilization,
      up: list.filter(o => o.up).length,
      in: list.filter(o => o.in).length,
    };
  });
  const rest = osds.filter(o => !seen.has(o.id));
  if (rest.length) {
    const size = rest.reduce((n, o) => n + o.sizeBytes, 0);
    const used = rest.reduce((n, o) => n + o.usedBytes, 0);
    out.push({
      host: '',
      osds: rest,
      sizeBytes: size,
      usedBytes: used,
      utilization: size ? (used / size) * 100 : 0,
      up: rest.filter(o => o.up).length,
      in: rest.filter(o => o.in).length,
    });
  }
  return out;
}
