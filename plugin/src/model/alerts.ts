/*
 * Cairn's own alerts: things worth knowing that Ceph's health does not
 * say, or says late. Each has a severity, a sentence, and the view where
 * it is fixed. Derived from the live state and the Rook resources; no
 * command runs here.
 */

import type { View } from '../shell/nav';
import { clusterState, crashCollectorDisabled } from './clusterSpec';
import { duration, plural } from './format';
import { EARLY_WARN_PCT, FLAG_BY_NAME, setFlags } from './osd';
import { AutoscaleStatus, CrashEntry, MgrInfo, Obj, Osd, OsdMapInfo, Pool, Quorum } from './types';

export type AlertTone = 'err' | 'warn' | 'idle';

export interface Alert {
  id: string;
  tone: AlertTone;
  title: string;
  detail?: string;
  link?: { view: View; a?: string; label: string };
}

export interface AlertInput {
  osdMap: OsdMapInfo | null;
  osds: Osd[];
  quorum: Quorum | null;
  mgr: MgrInfo | null;
  pools: Pool[];
  autoscale: AutoscaleStatus[];
  crashes: CrashEntry[];
  cephCluster: Obj | null;
  /** The Rook operator Deployment and its pods (any namespace). */
  operator: { deployment: Obj | null; pods: Obj[]; looked: boolean };
  now?: number;
}

const RANK: Record<AlertTone, number> = { err: 0, warn: 1, idle: 2 };
const CRASH_WINDOW_MS = 14 * 24 * 3600 * 1000;

const names = (list: string[], max = 4) => (list.length > max ? `${list.slice(0, max).join(', ')} and ${list.length - max} more` : list.join(', '));

const podRunning = (p: Obj) =>
  p.status?.phase === 'Running' && !p.metadata.deletionTimestamp && (p.status?.containerStatuses ?? []).every((c: any) => c.ready);

export function deriveAlerts(i: AlertInput): Alert[] {
  const now = i.now ?? Date.now();
  const out: Alert[] = [];
  const OSDS = { view: 'osds' as View, label: 'Open Hosts & OSDs' };

  // Cluster flags.
  const flags = [...setFlags(i.osdMap)].filter(f => f !== 'pauserd' && f !== 'pausewr');
  if (flags.length) {
    const pause = flags.includes('pause');
    out.push({
      id: 'flags',
      tone: pause || flags.includes('norecover') || flags.includes('nodown') ? 'err' : 'warn',
      title: flags.length === 1 ? `The cluster flag ${flags[0]} is set` : `Cluster flags are set: ${flags.join(', ')}`,
      detail: flags.map(f => `${f}: ${FLAG_BY_NAME.get(f)?.meaning ?? 'changes how the cluster behaves.'}`).join(' '),
      link: { ...OSDS, label: 'Review cluster flags' },
    });
  }

  // OSDs down or out.
  const down = i.osds.filter(o => !o.up);
  const out_ = i.osds.filter(o => o.up && !o.in);
  if (down.length)
    out.push({
      id: 'osd-down',
      tone: 'err',
      title: `${plural(down.length, 'OSD')} ${down.length === 1 ? 'is' : 'are'} down: ${names(down.map(o => o.name))}`,
      detail: down.some(o => o.in)
        ? 'Their placement groups run on fewer copies. Ceph marks them out after 10 minutes and rebuilds the copies elsewhere, unless noout is set.'
        : 'They are also out: their data has been or is being rebuilt elsewhere.',
      link: down.length === 1 ? { view: 'osds', a: String(down[0].id), label: `Open ${down[0].name}` } : OSDS,
    });
  if (out_.length)
    out.push({
      id: 'osd-out',
      tone: 'warn',
      title: `${plural(out_.length, 'OSD')} ${out_.length === 1 ? 'is' : 'are'} out: ${names(out_.map(o => o.name))}`,
      detail: 'They run but hold no data. Mark them in when the work that needed it is done.',
      link: out_.length === 1 ? { view: 'osds', a: String(out_[0].id), label: `Open ${out_[0].name}` } : OSDS,
    });

  // OSDs filling up before Ceph's near-full warning.
  const near = (i.osdMap?.nearFullRatio ?? 0.85) * 100;
  const filling = i.osds.filter(o => o.utilization >= EARLY_WARN_PCT && o.utilization < near);
  if (filling.length)
    out.push({
      id: 'osd-filling',
      tone: 'warn',
      title: `${plural(filling.length, 'OSD')} above ${EARLY_WARN_PCT}% full: ${names(filling.map(o => `${o.name} ${Math.round(o.utilization)}%`))}`,
      detail: `Ceph warns at ${Math.round(near)}% and stops moving data onto an OSD at ${Math.round((i.osdMap?.backfillFullRatio ?? 0.9) * 100)}%. Add capacity or even out the OSDs now.`,
      link: OSDS,
    });

  // Monitors.
  if (i.quorum) {
    const outQ = i.quorum.mons.filter(m => !m.inQuorum);
    const spare = i.quorum.quorum.length - (Math.floor(i.quorum.mons.length / 2) + 1);
    if (outQ.length)
      out.push({
        id: 'mon-quorum',
        tone: spare <= 0 ? 'err' : 'warn',
        title: `${plural(outQ.length, 'monitor')} out of quorum: ${names(outQ.map(m => `mon.${m.name}`))}`,
        detail: `${i.quorum.quorum.length} of ${i.quorum.mons.length} monitors form the quorum. ${
          spare <= 0 ? 'Losing one more stops the cluster.' : `The cluster survives losing ${plural(spare, 'more monitor')}.`
        }`,
        link: { view: 'daemons', a: 'mons', label: 'Open Monitors' },
      });
    if (i.quorum.mons.length > 0 && i.quorum.mons.length < 3)
      out.push({
        id: 'mon-count',
        tone: 'warn',
        title: `Only ${plural(i.quorum.mons.length, 'monitor')}`,
        detail: 'Losing one monitor stops the cluster. Run three (spec.mon.count: 3) on different nodes.',
        link: { view: 'daemons', a: 'mons', label: 'Open Monitors' },
      });
  }

  // Managers.
  if (i.mgr) {
    if (!i.mgr.available || !i.mgr.active)
      out.push({ id: 'mgr-none', tone: 'err', title: 'No active manager', detail: 'Statistics, metrics, the autoscaler and crash reports stop.', link: { view: 'daemons', a: 'mgr', label: 'Open Managers' } });
    else if (i.mgr.standbys.length === 0)
      out.push({
        id: 'mgr-standby',
        tone: 'warn',
        title: `No standby manager behind mgr.${i.mgr.active}`,
        detail: 'If it fails, statistics, metrics, the dashboard and the autoscaler stop until Kubernetes restarts it. Run two managers (spec.mgr.count: 2).',
        link: { view: 'daemons', a: 'mgr', label: 'Open Managers' },
      });
  }

  // Rook.
  const cc = i.cephCluster;
  if (cc) {
    if (crashCollectorDisabled(cc))
      out.push({
        id: 'crash-collector',
        tone: 'idle',
        title: 'The crash collector is off',
        detail: 'Daemon crashes are not collected, so Ceph cannot report them (spec.crashCollector.disable is true).',
        link: { view: 'daemons', a: 'operator', label: 'Open Rook operator' },
      });
    const s = clusterState(cc);
    if (!s.ready)
      out.push({
        id: 'cc-ready',
        tone: s.phase === 'Failure' || s.phase === 'Error' ? 'err' : 'warn',
        title: `The CephCluster is not ready${s.phase ? ` (${s.phase})` : ''}`,
        detail: s.message || 'Rook has not finished reconciling the cluster.',
        link: { view: 'daemons', a: 'operator', label: 'Open Rook operator' },
      });
    else if (s.pending)
      out.push({
        id: 'cc-pending',
        tone: 'idle',
        title: 'Rook has not applied the latest CephCluster change yet',
        detail: `Generation ${s.generation}, Rook last processed ${s.observedGeneration}.`,
        link: { view: 'daemons', a: 'operator', label: 'Open Rook operator' },
      });
  }
  if (i.operator.looked) {
    const d = i.operator.deployment;
    const running = i.operator.pods.some(podRunning);
    const avail = Number(d?.status?.availableReplicas ?? 0);
    if (!running && (d ? avail === 0 : true))
      out.push({
        id: 'operator',
        tone: 'err',
        title: 'The Rook operator is not running',
        detail: d
          ? `Deployment ${d.metadata.namespace}/${d.metadata.name} has no available replica. Changes to Rook resources are not applied, and failed daemons are not replaced.`
          : 'No rook-ceph-operator pod is visible. Changes to Rook resources are not applied.',
        link: { view: 'daemons', a: 'operator', label: 'Open Rook operator' },
      });
  }

  // Pools.
  for (const p of i.pools) {
    const POOL = { view: 'pools' as View, a: p.name, label: `Open ${p.name}` };
    if (p.type === 'replicated' && p.size === 1)
      out.push({ id: `pool-size-${p.id}`, tone: 'err', title: `Pool ${p.name} keeps a single copy`, detail: 'Losing one OSD loses data in it.', link: POOL });
    else if (p.type === 'replicated' && p.size > 0 && p.size < 3)
      out.push({
        id: `pool-size-${p.id}`,
        tone: 'warn',
        title: `Pool ${p.name} keeps only ${p.size} copies`,
        detail: 'With two copies, a second failure during recovery loses data. Use size 3 for data you keep.',
        link: POOL,
      });
    if (p.minSize === 1 && p.size > 1)
      out.push({
        id: `pool-min-${p.id}`,
        tone: 'warn',
        title: `Pool ${p.name} accepts writes with one copy (min_size 1)`,
        detail: 'Writes landing on a single copy are lost if that disk fails before recovery. Use min_size 2.',
        link: POOL,
      });
    if (p.type === 'erasure' && p.ec && p.minSize <= p.ec.k)
      out.push({
        id: `pool-min-${p.id}`,
        tone: 'warn',
        title: `Pool ${p.name} accepts writes with no spare chunk (min_size ${p.minSize}, k ${p.ec.k})`,
        detail: `Use min_size ${p.ec.k + 1} so a write always has one chunk to spare.`,
        link: POOL,
      });
  }

  // Autoscaler.
  for (const a of i.autoscale.filter(x => x.wouldAdjust)) {
    out.push({
      id: `autoscale-${a.poolId}`,
      tone: 'idle',
      title: `The autoscaler would change ${a.pool} from ${a.pgNum} to ${a.pgNumFinal} placement groups`,
      detail: a.mode === 'on' ? 'It will do it on its own.' : `Its mode is ${a.mode || 'warn'}: it waits for you.`,
      link: { view: 'pools', a: a.pool, label: `Open ${a.pool}` },
    });
  }

  // Recent crashes.
  const recent = i.crashes.filter(c => !c.archived && c.time && now - c.time < CRASH_WINDOW_MS);
  if (recent.length) {
    const last = recent[0];
    out.push({
      id: 'crashes',
      tone: 'warn',
      title: `${plural(recent.length, 'new crash report')}${last ? `, the latest from ${last.entity} ${duration((now - (last.time ?? now)) / 1000)} ago` : ''}`,
      detail: 'Read them below, then archive them.',
    });
  }

  return out.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}
