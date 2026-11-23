/*
 * Changes to the CephCluster resource that Cairn proposes (and shows as a
 * diff before anything is applied): disks and nodes in spec.storage, health
 * warnings muted through Rook (spec.healthCheck.muteHealthWarning), and
 * reading what the operator reports (phase, conditions, crash collector).
 * Every function returns a new object; the input is never changed.
 */

import { Obj } from './types';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/* -------------------------------------------------------------- storage */

export interface StorageDevice {
  name?: string;
  fullpath?: string;
  config?: Record<string, string>;
}

export interface StorageNode {
  name: string;
  devices: StorageDevice[];
  deviceFilter?: string;
  devicePathFilter?: string;
  useAllDevices?: boolean;
}

export interface StorageView {
  useAllNodes: boolean;
  useAllDevices: boolean;
  deviceFilter: string;
  devicePathFilter: string;
  nodes: StorageNode[];
  /** OSDs on PVCs (storageClassDeviceSets). */
  deviceSets: { name: string; count: number }[];
  /** How Rook picks disks today, in one sentence. */
  summary: string;
}

export function readStorage(cc: Obj | null | undefined): StorageView {
  const s = cc?.spec?.storage ?? {};
  const nodes: StorageNode[] = (Array.isArray(s.nodes) ? s.nodes : []).map((n: any) => ({
    name: String(n?.name ?? ''),
    devices: Array.isArray(n?.devices) ? n.devices.map((d: any) => ({ name: d?.name, fullpath: d?.fullpath, config: d?.config })) : [],
    deviceFilter: n?.deviceFilter,
    devicePathFilter: n?.devicePathFilter,
    useAllDevices: n?.useAllDevices,
  }));
  const deviceSets = (Array.isArray(s.storageClassDeviceSets) ? s.storageClassDeviceSets : []).map((d: any) => ({
    name: String(d?.name ?? ''),
    count: Number(d?.count ?? 0),
  }));
  const v: StorageView = {
    useAllNodes: !!s.useAllNodes,
    useAllDevices: !!s.useAllDevices,
    deviceFilter: s.deviceFilter ?? '',
    devicePathFilter: s.devicePathFilter ?? '',
    nodes,
    deviceSets,
    summary: '',
  };
  v.summary = describeStorage(v);
  return v;
}

function selection(useAll: boolean, filter: string, pathFilter: string): string {
  if (useAll) return 'every empty disk';
  if (filter) return `empty disks whose name matches ${filter}`;
  if (pathFilter) return `empty disks whose path matches ${pathFilter}`;
  return '';
}

export function describeStorage(v: StorageView): string {
  const pick = selection(v.useAllDevices, v.deviceFilter, v.devicePathFilter);
  const sets = v.deviceSets.length ? ` Plus ${v.deviceSets.reduce((n, d) => n + d.count, 0)} OSDs on PVCs (${v.deviceSets.map(d => d.name).join(', ')}).` : '';
  if (v.useAllNodes) return `${pick ? `Rook uses ${pick} on every node` : 'Rook uses every node, but no disk selection is set'}.${sets}`;
  if (!v.nodes.length) return `Rook uses no node directly.${sets}`;
  return `Rook uses ${v.nodes.length === 1 ? 'one listed node' : `${v.nodes.length} listed nodes`}${pick ? `, by default ${pick}` : ''}.${sets}`;
}

/** sdb, nvme0n1, vdc, dm-3, or a /dev/disk/by-id|by-path|by-uuid path. */
export function validateDevice(d: string): string | null {
  const s = d.trim();
  if (!s) return 'Name a device';
  if (s.startsWith('/dev/')) {
    if (/^\/dev\/disk\/by-(id|path|uuid|partuuid|wwn)\/[^\s/]+$/.test(s)) return null;
    if (/^\/dev\/[a-z][\w-]*$/.test(s)) return 'Use the device name without /dev/ (sdb), or a stable /dev/disk/by-id path';
    if (/^\/dev\/mapper\/[\w.-]+$/.test(s)) return null;
    return 'Not a device path Rook accepts: use /dev/disk/by-id/…, /dev/disk/by-path/… or a name like sdb';
  }
  if (/^[a-z][a-z0-9_-]*$/.test(s)) return null;
  return 'Not a device name: use the kernel name (sdb, nvme0n1) or a /dev/disk/by-id path';
}

/** A device entry as Rook wants it: names and full udev paths both go in `name`. */
export function deviceEntry(d: string): StorageDevice {
  return { name: d.trim() };
}

const sameDevice = (a: StorageDevice, d: string) => (a.name ?? a.fullpath ?? '') === d.trim();

export interface SpecChange {
  after: Obj;
  /** What Rook will do, one line each. */
  notes: string[];
  /** Things to know before applying. */
  warnings: string[];
  /** The change does nothing. */
  noop?: boolean;
}

/**
 * Adds devices on a node to spec.storage. With useAllNodes the node list is
 * ignored by Rook, so the change switches to an explicit list: every node
 * that holds OSDs today (inheriting the cluster-wide selection) plus this
 * one with its devices.
 */
export function addNodeDevices(cc: Obj, node: string, devices: string[], osdNodes: string[]): SpecChange {
  const after = clone(cc);
  after.spec = after.spec ?? {};
  const st = (after.spec.storage = after.spec.storage ?? {});
  const want = devices.map(d => d.trim()).filter(Boolean);
  const notes: string[] = [];
  const warnings: string[] = [];
  if (!node.trim()) throw new Error('Choose a node');
  if (!want.length) throw new Error('Name at least one device');
  for (const d of want) {
    const err = validateDevice(d);
    if (err) throw new Error(`${d}: ${err}`);
  }
  if (st.useAllNodes) {
    st.useAllNodes = false;
    const keep = [...new Set(osdNodes.filter(n => n && n !== node))].sort();
    st.nodes = keep.map(name => ({ name }));
    warnings.push(
      `useAllNodes is switched off: Rook ignores the node list while it is on. The ${keep.length} nodes that hold OSDs now (${keep.join(', ') || 'none'}) are listed and keep the cluster-wide disk selection. A node added to Kubernetes later no longer gets OSDs on its own.`
    );
  }
  st.nodes = Array.isArray(st.nodes) ? st.nodes : [];
  let entry = st.nodes.find((n: any) => n?.name === node);
  if (!entry) {
    entry = { name: node };
    st.nodes.push(entry);
  }
  const before: StorageDevice[] = Array.isArray(entry.devices) ? entry.devices : [];
  const added = want.filter(d => !before.some(x => sameDevice(x, d)));
  if (!added.length && before.length) return { after: clone(cc), notes: [], warnings: [`${node} already lists ${want.join(', ')}.`], noop: true };
  entry.devices = [...before, ...added.map(deviceEntry)];
  if (before.length === 0 && (st.deviceFilter || st.useAllDevices || st.devicePathFilter))
    warnings.push(
      `Listing devices on ${node} replaces the cluster-wide selection there: only the listed devices are used on that node. Disks that already hold OSDs there keep running.`
    );
  notes.push(
    `Rook runs an osd-prepare job on ${node}. It creates one OSD per listed device that is empty (no partitions, no filesystem); devices that are not empty are skipped and the job log says why.`,
    'Each new OSD joins CRUSH under its host, and Ceph starts moving placement groups onto it: expect backfill traffic until the data is balanced.',
    'Nothing is wiped: Rook never formats a device that holds data.'
  );
  return { after, notes, warnings };
}

/** Changes the cluster-wide deviceFilter (a regular expression on kernel names). */
export function setDeviceFilter(cc: Obj, filter: string, knownDevices: string[] = []): SpecChange & { matches: string[] } {
  const f = filter.trim();
  try {
    if (f) new RegExp(f);
  } catch (e) {
    throw new Error(`Not a valid regular expression: ${(e as Error).message}`);
  }
  const after = clone(cc);
  after.spec = after.spec ?? {};
  const st = (after.spec.storage = after.spec.storage ?? {});
  const was = st.deviceFilter ?? '';
  if (was === f) return { after: clone(cc), notes: [], warnings: ['The filter is unchanged.'], noop: true, matches: [] };
  if (f) st.deviceFilter = f;
  else delete st.deviceFilter;
  const re = f ? new RegExp(f) : null;
  const matches = re ? [...new Set(knownDevices)].filter(d => re.test(d)) : [];
  const notes = [
    `Rook runs an osd-prepare job on every ${st.useAllNodes ? 'node' : 'listed node without its own device list'} and creates OSDs on empty disks whose kernel name matches ${f || '(no filter)'}.`,
    'Existing OSDs keep running even when their disk no longer matches: Rook does not remove OSDs.',
    'New OSDs start receiving data at once (backfill).',
  ];
  const warnings: string[] = [];
  if (!f && !st.useAllDevices) warnings.push('Without a filter and with useAllDevices off, Rook picks no disk cluster-wide.');
  if (f && !/^\^/.test(f)) warnings.push(`The filter is not anchored (^…$): ${f} also matches longer names (sdb matches sdba, sdbb…).`);
  if (st.useAllDevices) warnings.push('useAllDevices is on: Rook uses every empty disk and the filter does not narrow it.');
  return { after, notes, warnings, matches };
}

/* --------------------------------------------------------- Rook mutes */

/** Rook's CRD allows codes like ^[A-Z]+(_[A-Z]+)+$ and at most 10 entries. */
export const ROOK_MUTE_PATTERN = /^[A-Z]+(_[A-Z]+)+$/;
export const ROOK_MUTE_MAX = 10;

export type RookMutePolicy = 'mute' | 'unmute';

export function rookMutes(cc: Obj | null | undefined): Record<string, RookMutePolicy> {
  const m = cc?.spec?.healthCheck?.muteHealthWarning ?? {};
  const out: Record<string, RookMutePolicy> = {};
  for (const [k, v] of Object.entries(m)) out[k] = (v as any)?.policy === 'unmute' ? 'unmute' : 'mute';
  return out;
}

/**
 * Sets spec.healthCheck.muteHealthWarning[code].policy. Rook mutes it in
 * Ceph and keeps it muted; to unmute, the policy becomes "unmute" (removing
 * the entry does not unmute).
 */
export function setRookMute(cc: Obj, code: string, policy: RookMutePolicy): SpecChange {
  if (!ROOK_MUTE_PATTERN.test(code))
    throw new Error(`${code} cannot be muted through Rook: its CRD accepts only codes made of letters and underscores (A_B). Mute it in Ceph instead.`);
  const current = rookMutes(cc);
  if (current[code] === policy) return { after: clone(cc), notes: [], warnings: [`${code} already has policy ${policy}.`], noop: true };
  if (!(code in current) && Object.keys(current).length >= ROOK_MUTE_MAX)
    throw new Error(`Rook accepts at most ${ROOK_MUTE_MAX} entries in muteHealthWarning; set one of the others to unmute and remove it first.`);
  const after = clone(cc);
  after.spec = after.spec ?? {};
  after.spec.healthCheck = after.spec.healthCheck ?? {};
  after.spec.healthCheck.muteHealthWarning = { ...(after.spec.healthCheck.muteHealthWarning ?? {}), [code]: { policy } };
  const notes =
    policy === 'mute'
      ? [
          `Rook mutes ${code} in Ceph at its next reconcile and keeps it muted (it mutes it again if someone unmutes it by hand).`,
          'The check stays visible as muted; HEALTH_WARN turns to HEALTH_OK if it was the only warning.',
          'To unmute later, set the policy to unmute: removing the entry does not unmute.',
        ]
      : [`Rook unmutes ${code} in Ceph at its next reconcile.`, 'After that you may remove the entry; while it says unmute, Rook keeps the check unmuted.'];
  return { after, notes, warnings: [] };
}

/* ------------------------------------------------------- what Rook says */

export function crashCollectorDisabled(cc: Obj | null | undefined): boolean {
  return !!cc?.spec?.crashCollector?.disable;
}

export interface ClusterCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  lastHeartbeatTime?: string;
}

export interface ClusterState {
  phase: string;
  state: string;
  message: string;
  ready: boolean;
  conditions: ClusterCondition[];
  generation: number;
  observedGeneration: number;
  /** Rook has not processed the latest spec yet. */
  pending: boolean;
  cephVersion: string;
  image: string;
  specImage: string;
}

export function clusterState(cc: Obj | null | undefined): ClusterState {
  const st = cc?.status ?? {};
  const conditions: ClusterCondition[] = Array.isArray(st.conditions) ? st.conditions : [];
  const readyCond = conditions.find(c => c.type === 'Ready');
  const phase = String(st.phase ?? '');
  const generation = Number(cc?.metadata?.generation ?? 0);
  const observedGeneration = Number(st.observedGeneration ?? 0);
  return {
    phase,
    state: String(st.state ?? ''),
    message: String(st.message ?? readyCond?.message ?? ''),
    ready: phase === 'Ready' && (!readyCond || readyCond.status === 'True'),
    conditions,
    generation,
    observedGeneration,
    pending: !!observedGeneration && generation > observedGeneration,
    cephVersion: String(st.version?.version ?? '').replace(/-0$/, ''),
    image: String(st.version?.image ?? ''),
    specImage: String(cc?.spec?.cephVersion?.image ?? ''),
  };
}
