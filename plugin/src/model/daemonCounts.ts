/*
 * How many managers and monitors the CephCluster asks for
 * (spec.mgr.count, spec.mon.count), which other counts the cluster can
 * take right now and why the rest are off, the change as a new
 * CephCluster with what Rook will do, and the mgr module entries Rook
 * ignores on the running Ceph release. Every function returns a new
 * object; the input is never changed.
 */

import { SpecChange } from './clusterSpec';
import { Obj } from './types';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* --------------------------------------------------------- Ceph release */

const RELEASES: Record<number, string> = {
  15: 'Octopus',
  16: 'Pacific',
  17: 'Quincy',
  18: 'Reef',
  19: 'Squid',
  20: 'Tentacle',
  21: 'Umbrella',
};

/**
 * The major Ceph version in any of the shapes Cairn sees: "20.2.4-0"
 * (Rook's status), "ceph version 20.2.4 (…) tentacle (stable)" (ceph
 * versions), "v20.2.4" or an image "quay.io/ceph/ceph:v20.2.4". Null when
 * it cannot tell.
 */
export function cephMajor(v: string | null | undefined): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /ceph version (\d+)\.\d+/.exec(s) ?? /(?:^|[:@/\sv])v?(\d+)\.\d+\.\d+/.exec(s) ?? /^v?(\d+)(?:\.\d+)*(?:-\d+)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

export function cephReleaseName(major: number | null): string {
  return major === null ? '' : RELEASES[major] ?? '';
}

/**
 * The Ceph version Rook acts on: the one it detected (status.version),
 * else the oldest manager version Ceph reports (mixed while upgrading),
 * else the image tag in the spec.
 */
export function runningCephVersion(cc: Obj | null | undefined, versions?: Record<string, Record<string, number>> | null): string {
  const st = String(cc?.status?.version?.version ?? '');
  if (cephMajor(st) !== null) return st.replace(/-0$/, '');
  const mgr = Object.keys(versions?.mgr ?? versions?.overall ?? {});
  const known = mgr.map(v => [v, cephMajor(v)] as const).filter(([, n]) => n !== null) as [string, number][];
  if (known.length) {
    const [v] = known.sort((a, b) => a[1] - b[1])[0];
    return /ceph version (\S+)/.exec(v)?.[1] ?? v;
  }
  const img = String(cc?.spec?.cephVersion?.image ?? '');
  const tag = /:v?(\d+\.\d+\.\d+)/.exec(img)?.[1];
  return tag ?? '';
}

/* ----------------------------------------------------- node placement */

interface Toleration {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
}
interface Taint {
  key: string;
  value?: string;
  effect: string;
}
interface Requirement {
  key: string;
  operator: string;
  values?: string[];
}

/** Does a toleration tolerate a taint (Kubernetes' rule)? */
export function tolerates(t: Toleration, taint: Taint): boolean {
  if (t.effect && t.effect !== taint.effect) return false;
  if (t.operator === 'Exists') return !t.key || t.key === taint.key;
  return t.key === taint.key && (t.value ?? '') === (taint.value ?? '');
}

function matchRequirement(r: Requirement, labels: Record<string, string>, fields: Record<string, string>, isField: boolean): boolean {
  const src = isField ? fields : labels;
  const has = Object.prototype.hasOwnProperty.call(src, r.key);
  const v = src[r.key];
  const vals = r.values ?? [];
  switch (r.operator) {
    case 'In':
      return has && vals.includes(v);
    case 'NotIn':
      return !has || !vals.includes(v);
    case 'Exists':
      return has;
    case 'DoesNotExist':
      return !has;
    case 'Gt':
      return has && Number(v) > Number(vals[0]);
    case 'Lt':
      return has && Number(v) < Number(vals[0]);
    default:
      return false;
  }
}

/** Does a node satisfy a required node affinity (any term; every expression of a term)? */
export function matchesNodeAffinity(node: Obj, affinity: any): boolean {
  const terms: any[] = affinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms ?? [];
  if (!terms.length) return true;
  const labels = node.metadata.labels ?? {};
  const fields = { 'metadata.name': node.metadata.name };
  return terms.some(term => {
    const exprs: Requirement[] = term?.matchExpressions ?? [];
    const fexprs: Requirement[] = term?.matchFields ?? [];
    if (!exprs.length && !fexprs.length) return false;
    return exprs.every(r => matchRequirement(r, labels, fields, false)) && fexprs.every(r => matchRequirement(r, labels, fields, true));
  });
}

/**
 * Rook's placement for a daemon type: placement.all, with the type's own
 * node affinity replacing it and its tolerations added (Rook's Merge).
 */
export function daemonPlacement(cc: Obj | null | undefined, daemon: 'mon' | 'mgr'): { nodeAffinity?: any; tolerations: Toleration[] } {
  const all = cc?.spec?.placement?.all ?? {};
  const own = cc?.spec?.placement?.[daemon] ?? {};
  return {
    nodeAffinity: own.nodeAffinity ?? all.nodeAffinity,
    tolerations: [...(Array.isArray(all.tolerations) ? all.tolerations : []), ...(Array.isArray(own.tolerations) ? own.tolerations : [])],
  };
}

/**
 * The nodes where Rook can run a monitor or a manager: not cordoned, every
 * NoSchedule/NoExecute taint tolerated, and the placement's required node
 * affinity met. Pod anti-affinity and resources are not checked.
 */
export function placeableNodes(nodes: Obj[], cc: Obj | null | undefined, daemon: 'mon' | 'mgr'): string[] {
  const p = daemonPlacement(cc, daemon);
  return nodes
    .filter(n => !n.spec?.unschedulable)
    .filter(n =>
      (Array.isArray(n.spec?.taints) ? (n.spec.taints as Taint[]) : [])
        .filter(t => t.effect === 'NoSchedule' || t.effect === 'NoExecute')
        .every(t => p.tolerations.some(tol => tolerates(tol, t)))
    )
    .filter(n => matchesNodeAffinity(n, p.nodeAffinity))
    .map(n => n.metadata.name)
    .sort();
}

/* ------------------------------------------------------------ options */

export interface CountOption {
  value: number;
  /** The CephCluster asks for this count now. */
  current: boolean;
  /** Why this count cannot be chosen now, or null. */
  off: string | null;
  /** Why this count needs an explicit confirmation, or null. */
  confirm: string | null;
  /** What this count means, in one sentence. */
  meaning: string;
}

/** Where the node limit comes from: placeable node names, or null when Cairn cannot list nodes. */
export interface NodeFacts {
  placeable: string[] | null;
}

const nodeLimit = (n: number, nodes: string[] | null, what: string): string | null => {
  if (nodes === null) return `Cairn cannot list the nodes, so it cannot tell whether ${n} ${what}s fit (one per node)`;
  if (n > nodes.length) return `Needs ${n} nodes that can run a ${what}, one per node; ${plural(nodes.length, 'node can', 'nodes can')}`;
  return null;
};

/* ------------------------------------------------------------- managers */

export const MGR_COUNTS = [1, 2];

export function mgrCount(cc: Obj | null | undefined): number {
  const n = Number(cc?.spec?.mgr?.count);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const MGR_MEANING: Record<number, string> = {
  1: 'No standby. If the manager stops, metrics, the dashboard, progress events, the PG autoscaler and the balancer stop until it is back: seconds to a minute when its pod restarts, several minutes when its node is down and Kubernetes has to move the pod. Client I/O is not affected.',
  2: 'One active, one standby on another node. If the active manager is lost with its node, the standby takes over as soon as the monitors miss its beacons (about 30 seconds), without waiting for Kubernetes. Rook runs two in its production example; use two when two or more nodes can run one.',
};

export function mgrOptions(cc: Obj | null | undefined, facts: NodeFacts): CountOption[] {
  const cur = mgrCount(cc);
  const multi = !!cc?.spec?.mgr?.allowMultiplePerNode;
  const values = [...new Set([...MGR_COUNTS, cur])].sort((a, b) => a - b);
  return values.map(v => {
    let off: string | null = null;
    if (v !== cur) {
      if (!MGR_COUNTS.includes(v)) off = 'Rook runs at most two managers';
      else if (v > 1 && !multi) off = nodeLimit(v, facts.placeable, 'manager');
    }
    return { value: v, current: v === cur, off, confirm: null, meaning: MGR_MEANING[v] ?? 'More managers than Rook supports: Rook runs at most two.' };
  });
}

export function setMgrCount(cc: Obj, n: number, facts: NodeFacts): SpecChange {
  const cur = mgrCount(cc);
  if (n === cur) return { after: clone(cc), notes: [], warnings: [`The CephCluster already asks for ${plural(n, 'manager', 'managers')}.`], noop: true };
  const opt = mgrOptions(cc, facts).find(o => o.value === n);
  if (!opt) throw new Error(`Rook runs one or two managers, not ${n}.`);
  if (opt.off) throw new Error(opt.off);
  const after = clone(cc);
  after.spec = after.spec ?? {};
  after.spec.mgr = { ...(after.spec.mgr ?? {}), count: n };
  const res = cc.spec?.resources?.mgr?.requests;
  const req = res ? Object.entries(res).map(([k, v]) => `${k} ${v}`).join(', ') : '';
  const notes =
    n > cur
      ? [
          `Rook creates a second manager (Deployment rook-ceph-mgr-b)${cc.spec?.mgr?.allowMultiplePerNode ? '' : ' on another node'}. Ceph keeps one active and the other on standby.`,
          'Rook also adds a watch-active sidecar to every manager pod, which keeps the manager Services on the active one: the running manager restarts once, so metrics and the dashboard pause for a few seconds.',
          'From then on, if the active manager is lost with its node, the standby takes over in about 30 seconds (when the monitors miss its beacons): metrics, the dashboard, progress events, the PG autoscaler and the balancer keep working.',
          `The standby uses ${req ? `what spec.resources.mgr requests (${req})` : 'as much CPU and memory as a manager'}.`,
          'Client I/O is not affected.',
        ]
      : [
          'Rook restarts mgr.a without its watch-active sidecar, then deletes rook-ceph-mgr-b; if mgr.b was active, mgr.a takes over. Metrics and the dashboard pause for a few seconds.',
          'From then on, a manager failure stops metrics, the dashboard, progress events, the PG autoscaler and the balancer until it is back: seconds to a minute when its pod restarts, several minutes when its node is down. Client I/O is not affected.',
        ];
  return { after, notes, warnings: [] };
}

/* ------------------------------------------------------------- monitors */

export const MON_COUNTS = [1, 3, 5];

const monMulti = (cc: Obj | null | undefined) => !!cc?.spec?.mon?.allowMultiplePerNode;

/** Rook's default when spec.mon.count is not set. */
export function monCount(cc: Obj | null | undefined): number {
  const n = Number(cc?.spec?.mon?.count);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** Monitors a quorum needs (a majority). */
export const quorumNeeds = (n: number) => Math.floor(n / 2) + 1;
/** Monitors that may be down while the quorum holds. */
export const monFailuresTolerated = (n: number) => Math.max(0, n - quorumNeeds(n));

/** What Ceph reports about the monitors now. */
export interface MonFacts extends NodeFacts {
  /** Monitors in the monmap; null while Cairn has not read the quorum. */
  monmap: string[] | null;
  /** Monitors in quorum now. */
  inQuorum: string[];
}

function monMeaning(n: number): string {
  const tol = monFailuresTolerated(n);
  if (n === 1) return 'One monitor, no quorum to lose but no failure tolerated: if it or its node fails, the cluster stops serving I/O until it is back.';
  return `Quorum needs ${quorumNeeds(n)} of ${n}: the cluster keeps running with ${plural(tol, 'monitor', 'monitors')} down${
    n % 2 === 0 ? `, no more than with ${n - 1} (an even count adds no tolerance)` : ''
  }.`;
}

/**
 * The monitor counts to offer: 1, 3, 5 and the current one. A count is off
 * when it does not fit the nodes (one monitor per node unless
 * allowMultiplePerNode), while Rook is still adding or removing monitors,
 * and while a monitor is out of quorum (adding or removing one then can
 * lose the quorum). Fewer than three on a cluster with three or more
 * nodes needs an explicit confirmation.
 */
export function monOptions(cc: Obj | null | undefined, facts: MonFacts): CountOption[] {
  const cur = monCount(cc);
  const multi = monMulti(cc);
  const values = [...new Set([...MON_COUNTS, cur])].sort((a, b) => a - b);
  const out = facts.monmap ? facts.monmap.filter(m => !facts.inQuorum.includes(m)) : [];
  const nodes = facts.placeable;
  return values.map(v => {
    let off: string | null = null;
    let confirm: string | null = null;
    if (v !== cur) {
      if (!MON_COUNTS.includes(v)) off = 'Choose an odd count: 1, 3 or 5';
      else if (!multi) off = nodeLimit(v, nodes, 'monitor');
      if (!off && facts.monmap === null) off = 'Cairn needs the live quorum to check that the change is safe';
      if (!off && facts.monmap && facts.monmap.length !== cur)
        off = `Rook is still moving to ${cur} monitors (the monmap has ${facts.monmap.length}): wait until it is done`;
      if (!off && out.length)
        off = `${out.map(m => `mon.${m}`).join(', ')} ${out.length === 1 ? 'is' : 'are'} out of quorum: changing the count now could lose the quorum. Wait until every monitor is in quorum`;
      if (!off && v < 3 && (nodes === null || nodes.length >= 3))
        confirm = `With ${plural(v, 'monitor', 'monitors')} the cluster tolerates no monitor failure, although ${
          nodes ? `${nodes.length} nodes could run` : 'the cluster could run'
        } three.`;
    }
    return { value: v, current: v === cur, off, confirm, meaning: monMeaning(v) };
  });
}

/** The new CephCluster with spec.mon.count = n; throws when the count is off. */
export function setMonCount(cc: Obj, n: number, facts: MonFacts, confirmed = false): SpecChange & { confirm: string | null } {
  const cur = monCount(cc);
  if (n === cur)
    return { after: clone(cc), notes: [], warnings: [`The CephCluster already asks for ${plural(n, 'monitor', 'monitors')}.`], noop: true, confirm: null };
  const opt = monOptions(cc, facts).find(o => o.value === n);
  if (!opt) throw new Error(`Choose an odd count: ${MON_COUNTS.join(', ')}.`);
  if (opt.off) throw new Error(opt.off);
  if (opt.confirm && !confirmed) throw new Error(`${opt.confirm} Confirm it explicitly to go on.`);
  const after = clone(cc);
  after.spec = after.spec ?? {};
  after.spec.mon = { ...(after.spec.mon ?? {}), count: n };
  const warnings: string[] = [];
  const notes: string[] = [];
  const d = Math.abs(n - cur);
  if (n > cur) {
    notes.push(
      `Rook adds ${plural(d, 'monitor', 'monitors')}, one at a time, each on a node without one. A new monitor copies the monitor database and joins the quorum.`,
      `Then the quorum needs ${quorumNeeds(n)} of ${n}: the cluster keeps running with ${plural(monFailuresTolerated(n), 'monitor', 'monitors')} down instead of ${monFailuresTolerated(cur)}.`,
      'Rook updates the monitor endpoints it gives to clients and to Ceph-CSI; running clients learn the new monitors from the monmap.'
    );
    if (monMulti(cc)) warnings.push('allowMultiplePerNode is on: several monitors may land on one node, and losing that node loses all of them.');
  } else {
    notes.push(
      `Rook removes ${plural(d, 'monitor', 'monitors')}, one per monitor health check (every 45 seconds by default), and takes each out of the monmap. Every monitor is in quorum now, so the quorum holds at each step.`,
      n === 1
        ? 'Then there is no quorum to keep: the single monitor holds the cluster maps alone.'
        : `Then the quorum needs ${quorumNeeds(n)} of ${n}: the cluster keeps running with ${plural(monFailuresTolerated(n), 'monitor', 'monitors')} down instead of ${monFailuresTolerated(cur)}.`,
      'Do not restart or drain the nodes of the remaining monitors until Rook has finished.'
    );
  }
  if (n === 1)
    warnings.push(
      'One monitor is a single point of failure: if it or its node fails, every client and daemon stops until it is back, and if its data directory is lost, the cluster maps have to be rebuilt from the OSDs.'
    );
  return { after, notes, warnings, confirm: opt.confirm };
}

/* ---------------------------------------------------------- mgr modules */

export interface MgrModuleEntry {
  name: string;
  enabled: boolean;
}

export function specModules(cc: Obj | null | undefined): MgrModuleEntry[] {
  const m = cc?.spec?.mgr?.modules;
  return (Array.isArray(m) ? m : []).map((x: any) => ({ name: String(x?.name ?? ''), enabled: x?.enabled !== false }));
}

/**
 * Why Rook ignores a module the CephCluster lists, or null. Rook 1.21
 * disables the rook orchestrator module on Ceph 20 (Tentacle) and later,
 * whatever the spec says.
 */
export function ignoredModuleReason(cc: Obj | null | undefined, name: string, cephVersion: string): string | null {
  const e = specModules(cc).find(m => m.name === name);
  if (!e || !e.enabled) return null;
  const major = cephMajor(cephVersion);
  if (name === 'rook' && major !== null && major >= 20)
    return `Rook disables the rook module on Ceph 20 (Tentacle) and later; this cluster runs Ceph ${cephVersion}${
      cephReleaseName(major) && major !== 20 ? ` (${cephReleaseName(major)})` : ''
    }. The entry in spec.mgr.modules has no effect.`;
  return null;
}

/** The CephCluster without the module's entry in spec.mgr.modules. */
export function removeMgrModule(cc: Obj, name: string, cephVersion = ''): SpecChange {
  const list = cc.spec?.mgr?.modules;
  if (!Array.isArray(list) || !list.some((x: any) => x?.name === name))
    return { after: clone(cc), notes: [], warnings: [`spec.mgr.modules does not list ${name}.`], noop: true };
  const after = clone(cc);
  const rest = (after.spec.mgr.modules as any[]).filter(x => x?.name !== name);
  if (rest.length) after.spec.mgr.modules = rest;
  else delete after.spec.mgr.modules;
  const ignored = ignoredModuleReason(cc, name, cephVersion);
  const notes = ignored
    ? [
        ignored,
        `Removing the entry changes nothing in Ceph: Rook already keeps ${name} disabled. The CephCluster then says what the cluster really runs.`,
        'No daemon restarts.',
      ]
    : [
        `Rook stops managing ${name}: it no longer enables it. Removing the entry does not disable a module that is on; disable it in the module list if you want it off.`,
        'No daemon restarts.',
      ];
  return { after, notes, warnings: [] };
}
