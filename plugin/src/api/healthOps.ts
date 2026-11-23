/*
 * Ceph health operations of the overview: mute and unmute a health check
 * (in Ceph; muting through Rook is a CephCluster change, see
 * model/clusterSpec), crash reports (details, archive one, archive all).
 */

import { muteCommand, unmuteCommand } from '../model/health';
import { cephBatch, CephError, mgr } from './bridge';
import { cephOp } from './osdOps';

export function muteCheck(ns: string, code: string, ttl: string, sticky: boolean, after?: () => void) {
  return cephOp(ns, {
    title: `Mute ${code}${ttl ? ` for ${ttl}` : ' until it clears'}${sticky ? ' (sticky)' : ''}`,
    target: code,
    cmd: muteCommand(code, ttl, sticky),
    after,
  });
}

export function unmuteCheck(ns: string, code: string, after?: () => void) {
  return cephOp(ns, { title: `Unmute ${code}`, target: code, cmd: unmuteCommand(code), after });
}

export function archiveCrash(ns: string, id: string, entity: string, after?: () => void) {
  return cephOp(ns, { title: `Archive the crash report of ${entity}`, target: entity, cmd: { prefix: 'crash archive', id }, invalidate: 'crash.', after });
}

export function archiveAllCrashes(ns: string, after?: () => void) {
  return cephOp(ns, { title: 'Archive every crash report', target: 'crash reports', cmd: { prefix: 'crash archive-all' }, invalidate: 'crash.', after });
}

/** "crash info" (mgr): the full report, read-only. */
export async function crashInfo(ns: string, id: string): Promise<Record<string, any>> {
  const [res] = await cephBatch(ns, [mgr('crash info', { id })]);
  if (!res || res.r !== 0) throw new CephError(res?.err || 'No answer', res?.r ?? -1);
  return (res.out ?? {}) as Record<string, any>;
}
