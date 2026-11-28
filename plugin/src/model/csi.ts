/*
 * Ceph-CSI as Kubernetes runs it: the drivers (ceph-csi operator Driver
 * CRs, or the CSIDriver objects and StorageClass provisioners of an older
 * Rook), each driver's controller plugin (a Deployment) and node plugin (a
 * DaemonSet), the node plugin pod of every node, and the nodes where Ceph
 * volumes cannot be mounted because no node plugin runs there.
 */

import { CephCsiKind,cephKindOf } from './storageclass';
import { Obj } from './types';

export interface CsiDriverInfo {
  name: string;
  kind: CephCsiKind;
  /** The ceph-csi operator's Driver CR, when there is one. */
  cr?: Obj;
  /** The Kubernetes CSIDriver object, when readable. */
  csiDriver?: Obj;
  /** Ceph StorageClasses using it. */
  classes: string[];
}

/** Every Ceph CSI driver Cairn can see, from Driver CRs, CSIDriver objects and class provisioners. */
export function csiDrivers(drivers: Obj[], csiDriverObjs: Obj[], scs: Obj[]): CsiDriverInfo[] {
  const m = new Map<string, CsiDriverInfo>();
  const add = (name: string) => {
    const kind = cephKindOf(name);
    if (!kind || kind === 'bucket') return null;
    let d = m.get(name);
    if (!d) {
      d = { name, kind, classes: [] };
      m.set(name, d);
    }
    return d;
  };
  for (const d of drivers) {
    const i = add(d.metadata.name);
    if (i) i.cr = d;
  }
  for (const d of csiDriverObjs) {
    const i = add(d.metadata.name);
    if (i) i.csiDriver = d;
  }
  for (const sc of scs) {
    const i = add(sc.provisioner);
    if (i) i.classes.push(sc.metadata.name);
  }
  const order: Record<string, number> = { rbd: 0, cephfs: 1, nfs: 2 };
  return [...m.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

export const DRIVER_WORDS: Record<CephCsiKind, string> = {
  rbd: 'Block volumes (RBD)',
  cephfs: 'Shared filesystems (CephFS)',
  nfs: 'NFS exports',
  bucket: 'Object buckets',
};

/** Names the plugin workloads have: ceph-csi operator, then the older Rook-managed CSI. */
function workloadNames(driver: string, kind: CephCsiKind): { ctrl: string[]; node: string[] } {
  const legacy: Record<string, [string, string]> = {
    rbd: ['csi-rbdplugin-provisioner', 'csi-rbdplugin'],
    cephfs: ['csi-cephfsplugin-provisioner', 'csi-cephfsplugin'],
    nfs: ['csi-nfsplugin-provisioner', 'csi-nfsplugin'],
  };
  const [lc, ln] = legacy[kind] ?? ['', ''];
  return { ctrl: [`${driver}-ctrlplugin`, lc].filter(Boolean), node: [`${driver}-nodeplugin`, ln].filter(Boolean) };
}

const byNameOrApp = (objs: Obj[], names: string[]) => {
  for (const n of names) {
    const o = objs.find(x => x.metadata.name === n) ?? objs.find(x => x.metadata.labels?.app === n);
    if (o) return o;
  }
  return undefined;
};

/** Pods selected by a Deployment or DaemonSet (its matchLabels). */
export function podsOf(workload: Obj | undefined, pods: Obj[]): Obj[] {
  const sel: Record<string, string> | undefined = workload?.spec?.selector?.matchLabels;
  if (!workload || !sel || !Object.keys(sel).length) return [];
  return pods.filter(
    p => p.metadata.namespace === workload.metadata.namespace && Object.entries(sel).every(([k, v]) => p.metadata.labels?.[k] === v)
  );
}

export interface DriverWorkloads {
  ctrl?: Obj;
  node?: Obj;
  ctrlPods: Obj[];
  nodePods: Obj[];
}

export function driverWorkloads(d: CsiDriverInfo, deployments: Obj[], daemonSets: Obj[], pods: Obj[]): DriverWorkloads {
  const names = workloadNames(d.name, d.kind);
  const ctrl = byNameOrApp(deployments, names.ctrl);
  const node = byNameOrApp(daemonSets, names.node);
  return { ctrl, node, ctrlPods: podsOf(ctrl, pods), nodePods: podsOf(node, pods) };
}

export interface PodHealth {
  ready: boolean;
  readyContainers: number;
  containers: number;
  restarts: number;
  phase: string;
  /** Why it is not ready (waiting reason, last termination). */
  reason?: string;
}

export function podHealth(p: Obj): PodHealth {
  const cs: any[] = p.status?.containerStatuses ?? [];
  const readyContainers = cs.filter(c => c.ready).length;
  const containers = (p.spec?.containers ?? []).length || cs.length;
  const restarts = cs.reduce((n, c) => n + (c.restartCount ?? 0), 0);
  const waiting = cs.map(c => c.state?.waiting?.reason).find(Boolean);
  const terminated = cs.map(c => c.lastState?.terminated?.reason).find(Boolean);
  const phase = p.metadata.deletionTimestamp ? 'Terminating' : p.status?.phase ?? 'Unknown';
  const ready = phase === 'Running' && containers > 0 && readyContainers === containers;
  return { ready, readyContainers, containers, restarts, phase, reason: ready ? undefined : waiting ?? terminated ?? p.status?.reason };
}

export interface NodeCoverage {
  node: string;
  pod?: Obj;
  health?: PodHealth;
  /** The kubelet has the driver registered (CSINode). undefined when CSINodes are not readable. */
  registered?: boolean;
  /** Why no node plugin runs there (taints, unschedulable, not ready). */
  why?: string;
  tone: 'ok' | 'warn' | 'err' | 'idle';
  word: string;
}

const taintText = (t: any) => `${t.key}${t.value ? `=${t.value}` : ''}:${t.effect}`;

function tolerated(taint: any, tolerations: any[]): boolean {
  return tolerations.some(
    t =>
      (t.operator === 'Exists' && (!t.key || t.key === taint.key) && (!t.effect || t.effect === taint.effect)) ||
      (t.key === taint.key && (t.value ?? '') === (taint.value ?? '') && (!t.effect || t.effect === taint.effect))
  );
}

/** For every node: its node plugin pod for this driver, or why there is none. */
export function nodeCoverage(nodes: Obj[], nodePlugin: Obj | undefined, nodePods: Obj[], driver: string, csiNodes?: Obj[]): NodeCoverage[] {
  const tolerations: any[] = nodePlugin?.spec?.template?.spec?.tolerations ?? [];
  return nodes
    .map(n => {
      const name = n.metadata.name;
      const pod = nodePods.find(p => p.spec?.nodeName === name);
      const csiNode = csiNodes?.find(c => c.metadata.name === name);
      const registered = csiNodes ? !!csiNode?.spec?.drivers?.some((d: any) => d.name === driver) : undefined;
      const nodeReady = (n.status?.conditions ?? []).find((c: any) => c.type === 'Ready')?.status === 'True';
      if (pod) {
        const health = podHealth(pod);
        const ok = health.ready && registered !== false;
        return {
          node: name,
          pod,
          health,
          registered,
          tone: ok ? 'ok' : health.ready ? 'warn' : 'err',
          word: ok ? 'Can mount' : health.ready ? 'Not registered with the kubelet' : `Node plugin ${health.phase === 'Running' ? 'not ready' : health.phase.toLowerCase()}`,
        } as NodeCoverage;
      }
      const blocking = (n.spec?.taints ?? []).filter((t: any) => (t.effect === 'NoSchedule' || t.effect === 'NoExecute') && !tolerated(t, tolerations));
      const why = blocking.length
        ? `Tainted ${blocking.map(taintText).join(', ')} and the node plugin does not tolerate it`
        : !nodeReady
        ? 'The node is not ready'
        : nodePlugin
        ? 'The DaemonSet has not placed a pod here (node selector or affinity)'
        : 'No node plugin DaemonSet found';
      return { node: name, registered, why, tone: nodeReady ? 'err' : 'idle', word: 'Cannot mount' } as NodeCoverage;
    })
    .sort((a, b) => a.node.localeCompare(b.node));
}

export interface ImageRef {
  container: string;
  image: string;
  /** The tag, or the digest's first characters. */
  version: string;
}

export function imagesOf(workload: Obj | undefined): ImageRef[] {
  const spec = workload?.spec?.template?.spec;
  const cs: any[] = [...(spec?.initContainers ?? []), ...(spec?.containers ?? [])];
  return cs.map(c => ({ container: c.name, image: c.image ?? '', version: versionOf(c.image ?? '') }));
}

export function versionOf(image: string): string {
  const at = image.indexOf('@');
  if (at >= 0) return image.slice(at + 1, at + 20);
  const slash = image.lastIndexOf('/');
  const colon = image.lastIndexOf(':');
  return colon > slash ? image.slice(colon + 1) : 'latest';
}

/** Ready/desired of a Deployment or DaemonSet, with a tone and a word. */
export function rollout(w: Obj | undefined): { ready: number; want: number; updated: number; tone: 'ok' | 'warn' | 'err' | 'idle'; word: string } {
  if (!w) return { ready: 0, want: 0, updated: 0, tone: 'idle', word: 'Not found' };
  const ds = w.kind === 'DaemonSet' || w.status?.desiredNumberScheduled !== undefined;
  const want = ds ? w.status?.desiredNumberScheduled ?? 0 : w.spec?.replicas ?? 1;
  const ready = ds ? w.status?.numberReady ?? 0 : w.status?.readyReplicas ?? 0;
  const updated = ds ? w.status?.updatedNumberScheduled ?? 0 : w.status?.updatedReplicas ?? 0;
  const tone = want === 0 ? 'idle' : ready >= want ? (updated < want ? 'warn' : 'ok') : ready === 0 ? 'err' : 'warn';
  const word = want === 0 ? 'Scaled to zero' : ready >= want ? (updated < want ? 'Updating' : 'Ready') : ready === 0 ? 'Down' : 'Degraded';
  return { ready, want, updated, tone, word };
}

/** The ceph-csi operator (ceph-csi-controller-manager), when deployed. */
/** The prefix of the image-set ConfigMaps k4all writes for its cephcsi build (k4all-cephcsi-<tag>). */
export const K4ALL_IMAGE_SET_PREFIX = 'k4all-cephcsi-';

/**
 * The image set (a ConfigMap in the Driver's namespace) a ceph-csi Driver
 * names in spec.imageSet: it wins key by key over the OperatorConfig's set.
 * `k4all`: on a k4all cluster, k4all chose it (its CSI image variant for the
 * nodes' CPUs, from its ceph-csi-drivers values).
 */
export function driverImageSet(driver: Obj | undefined, k4all: boolean): { name: string; k4all: boolean } | null {
  const name = driver?.spec?.imageSet?.name;
  if (typeof name !== 'string' || !name) return null;
  return { name, k4all: k4all && name.startsWith(K4ALL_IMAGE_SET_PREFIX) };
}

export function csiOperator(deployments: Obj[]): Obj | undefined {
  return (
    deployments.find(d => d.metadata.name === 'ceph-csi-controller-manager') ??
    deployments.find(d => d.metadata.labels?.['app.kubernetes.io/name'] === 'ceph-csi' && /operator|controller-manager/.test(d.metadata.name))
  );
}
