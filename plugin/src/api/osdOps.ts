/*
 * Ceph operations of the Hosts & OSDs and Daemons views: one command, or
 * a sequence of steps (maintenance), each recorded in the activity log
 * with the command as the CLI would print it. Monitor or manager command
 * is chosen by prefix.
 */

import { cliText } from '../model/health';
import { MGR_PREFIXES, PlanStep } from '../model/osd';
import { runOp } from './activity';
import { CephQuery } from './bridge';
import { invalidateCephQueries, runCeph } from './ceph';

/** Manager commands among those Cairn runs (the rest go to the monitors). */
const MGR = new Set([...MGR_PREFIXES, 'crash ls', 'crash info', 'crash archive', 'crash archive-all', 'crash post', 'crash rm', 'crash stat']);

export function routed(cmd: Record<string, unknown>, inbuf?: string): CephQuery {
  const t = MGR.has(String(cmd.prefix)) ? 'mgr' : 'mon';
  return inbuf !== undefined ? { t, cmd, in: inbuf } : { t, cmd };
}

/**
 * Runs one Ceph command as an operation. `invalidate` drops cached view
 * queries with that key prefix afterwards; `after` runs on success (a
 * live-state refresh).
 */
export async function cephOp(
  ns: string,
  o: { title: string; target?: string; cmd: Record<string, unknown>; inbuf?: string; invalidate?: string; after?: () => void }
): Promise<string> {
  try {
    return await runOp({
      title: o.title,
      target: o.target,
      detail: cliText(o.cmd),
      run: () => runCeph(ns, routed(o.cmd, o.inbuf)),
    });
  } finally {
    if (o.invalidate !== undefined) invalidateCephQueries(o.invalidate);
    o.after?.();
  }
}

/**
 * Runs the steps in order, one operation each; stops at the first that
 * fails (and rethrows). `invalidate` drops cached view queries afterwards.
 */
export async function cephSteps(ns: string, steps: PlanStep[], target: string, after?: () => void, invalidate?: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for (const s of steps) out.push(await cephOp(ns, { title: s.text, target, cmd: s.cmd }));
  } finally {
    if (invalidate !== undefined) invalidateCephQueries(invalidate);
    after?.();
  }
  return out;
}
