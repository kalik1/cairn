/*
 * Pods of the Rook namespace by Ceph daemon type, with their state in one
 * word, restarts, age and image version.
 */

import { Obj } from '../../model/types';
import type { StateTone } from '../../ui/tokens';

export type DaemonType =
  | 'mon'
  | 'mgr'
  | 'osd'
  | 'mds'
  | 'rgw'
  | 'exporter'
  | 'crashcollector'
  | 'csi'
  | 'osd-prepare'
  | 'operator'
  | 'toolbox'
  | 'other';

export const TYPE_LABEL: Record<DaemonType, string> = {
  mon: 'Monitors',
  mgr: 'Managers',
  osd: 'OSDs',
  mds: 'Metadata servers',
  rgw: 'Object gateways',
  exporter: 'Exporters',
  crashcollector: 'Crash collectors',
  csi: 'CSI',
  'osd-prepare': 'OSD prepare jobs',
  operator: 'Rook operator',
  toolbox: 'Toolbox',
  other: 'Other',
};

export const TYPE_ORDER: DaemonType[] = ['mon', 'mgr', 'osd', 'mds', 'rgw', 'exporter', 'crashcollector', 'csi', 'osd-prepare', 'operator', 'toolbox', 'other'];

export function daemonType(p: Obj): DaemonType {
  const l = p.metadata.labels ?? {};
  const app = l.app ?? l['app.kubernetes.io/name'] ?? '';
  const name = p.metadata.name;
  if (app === 'rook-ceph-osd-prepare') return 'osd-prepare';
  if (app === 'rook-ceph-operator') return 'operator';
  if (app === 'rook-ceph-tools') return 'toolbox';
  if (app === 'rook-ceph-exporter') return 'exporter';
  if (app === 'rook-ceph-crashcollector') return 'crashcollector';
  if (/csi/.test(app) || /csi/.test(name)) return 'csi';
  const t = l.ceph_daemon_type;
  if (t === 'mon' || t === 'mgr' || t === 'osd' || t === 'mds' || t === 'rgw') return t;
  const m = app.match(/^rook-ceph-(mon|mgr|osd|mds|rgw)$/);
  if (m) return m[1] as DaemonType;
  return 'other';
}

export function podState(p: Obj): { word: string; tone: StateTone } {
  if (p.metadata.deletionTimestamp) return { word: 'Terminating', tone: 'move' };
  const phase = p.status?.phase ?? 'Unknown';
  const cs: any[] = p.status?.containerStatuses ?? [];
  const waiting = cs.map(c => c.state?.waiting?.reason).find(Boolean);
  if (phase === 'Succeeded') return { word: 'Completed', tone: 'idle' };
  if (phase === 'Failed') return { word: p.status?.reason ?? 'Failed', tone: 'err' };
  if (waiting && /BackOff|Err|Invalid/.test(waiting)) return { word: waiting, tone: 'err' };
  if (phase === 'Pending') return { word: waiting ?? 'Pending', tone: 'warn' };
  if (phase === 'Running') return cs.length && cs.every(c => c.ready) ? { word: 'Running', tone: 'ok' } : { word: 'Not ready', tone: 'warn' };
  return { word: phase, tone: 'idle' };
}

export function restarts(p: Obj): number {
  return (p.status?.containerStatuses ?? []).reduce((n: number, c: any) => n + Number(c.restartCount ?? 0), 0);
}

/** Main container image, and its tag ("quay.io/ceph/ceph:v20.2.4" → "v20.2.4"). */
export function podImage(p: Obj): { image: string; tag: string } {
  const c = (p.spec?.containers ?? [])[0];
  const image = String(c?.image ?? '');
  const at = image.lastIndexOf('@');
  const colon = image.lastIndexOf(':');
  const tag = at > 0 ? image.slice(at + 1, at + 20) : colon > image.lastIndexOf('/') ? image.slice(colon + 1) : 'latest';
  return { image, tag };
}

/** The Ceph daemon id ("a", "0") from Rook's labels. */
export function daemonId(p: Obj): string {
  const l = p.metadata.labels ?? {};
  return l.ceph_daemon_id ?? l.mon ?? l.mgr ?? l.osd ?? l['ceph-osd-id'] ?? '';
}

/** "versions" (daemon → version → count): more than one version overall. */
export function mixedVersions(v: Record<string, Record<string, number>> | null | undefined): string[] {
  const overall = v?.overall ? Object.keys(v.overall) : [...new Set(Object.values(v ?? {}).flatMap(x => Object.keys(x)))];
  return overall.length > 1 ? overall : [];
}

/** Can one more monitor stop without losing quorum? */
export function monRestartSafety(mons: number, inQuorum: number): { safe: boolean; text: string } {
  const need = Math.floor(mons / 2) + 1;
  const spare = inQuorum - need;
  if (mons === 0) return { safe: false, text: 'No monitors are known.' };
  if (spare >= 1)
    return {
      safe: true,
      text: `Restarting one monitor at a time is safe now: ${inQuorum - 1} of ${mons} would keep the quorum (${need} needed). Wait until it is back in quorum before the next one.`,
    };
  if (inQuorum < need) return { safe: false, text: `The quorum is lost (${inQuorum} of ${mons}, ${need} needed): bring monitors back, do not restart others.` };
  return {
    safe: false,
    text: `Not safe now: ${inQuorum} of ${mons} monitors form the quorum and ${need} are needed. Restarting one in quorum stops the cluster until it returns.`,
  };
}
