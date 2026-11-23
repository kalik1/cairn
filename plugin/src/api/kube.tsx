/*
 * The Kubernetes side Cairn reads: Rook's custom resources, the storage
 * objects backed by Ceph (StorageClasses, snapshot classes, PVs, PVCs),
 * Ceph-CSI drivers, the pods and events of the Rook namespace, nodes.
 *
 * Lists that change often are watched (Headlamp's list hooks: a list,
 * then a watch); the rest are polled, to keep the number of WebSockets
 * low. A 404 means the CRD is missing: `has` turns the feature off.
 */

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { Obj } from '../model/types';
import { useSettings } from '../shell/settings';
import { currentCluster } from './client';
import {
  CephBlockPool,
  CephBlockPoolRadosNamespace,
  CephClient,
  CephCluster,
  CephFilesystem,
  CephFilesystemMirror,
  CephFilesystemSubVolumeGroup,
  CephNFS,
  CephNVMeOFGateway,
  CephObjectStore,
  CephObjectStoreUser,
  CephObjectZone,
  CephRBDMirror,
  CsiDriver,
  KubeEvent,
  ObjectBucketClaim,
  VolumeSnapshotClass,
} from './resources';

export interface ListState {
  items: Obj[];
  error: any;
  loaded: boolean;
  /** The kind does not exist on this cluster (CRD missing). */
  missing: boolean;
  /** The user may not list it. */
  forbidden: boolean;
}

export interface KubeData {
  cluster: string;
  /** All CephClusters, and the one shown. */
  cephClusters: ListState;
  cephCluster: Obj | null;
  /** Namespace of the CephCluster shown ("rook-ceph"). */
  ns: string;
  blockPools: ListState;
  radosNamespaces: ListState;
  filesystems: ListState;
  subVolumeGroups: ListState;
  fsMirrors: ListState;
  objectStores: ListState;
  objectUsers: ListState;
  objectZones: ListState;
  bucketClaims: ListState;
  clients: ListState;
  nfs: ListState;
  rbdMirrors: ListState;
  nvmeof: ListState;
  storageClasses: ListState;
  snapshotClasses: ListState;
  pvs: ListState;
  pvcs: ListState;
  csiDrivers: ListState;
  nodes: ListState;
  namespaces: ListState;
  /** Pods of the Rook namespace (daemons, CSI, operator). */
  rookPods: ListState;
  /** Events of the Rook namespace, newest first. */
  events: ListState;
  /** Deployments and DaemonSets of the Rook namespace. */
  deployments: ListState;
  daemonSets: ListState;
  refresh: () => void;
}

function useList(cls: any, opts?: Record<string, any>): ListState {
  const res = cls.useList(opts ?? {});
  const items: any[] | null = (res as any).items ?? (res as any)[0] ?? null;
  const error = (res as any).error ?? (res as any)[1] ?? null;
  // Headlamp may hand back a new array on every render: key on what changed.
  const sig = items ? items.map(i => `${i?.metadata?.uid}:${i?.metadata?.resourceVersion}`).join(',') : 'null';
  const errSig = error ? `${error.status}:${error.message}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const out = React.useMemo(() => (items ?? []).map((i: any) => (i?.jsonData ?? i) as Obj), [sig]);
  const loaded = items !== null || !!error;
  const missing = !!error && (error.status === 404 || /not found|could not find/i.test(String(error.message ?? '')));
  const forbidden = !!error && error.status === 403;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => ({ items: out, error, loaded, missing, forbidden }), [out, errSig, loaded]);
}

const Ctx = React.createContext<KubeData | null>(null);

export function useKube(): KubeData {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useKube outside KubeProvider');
  return v;
}

const byTimeDesc = (a: Obj, b: Obj) =>
  (b.lastTimestamp ?? b.eventTime ?? b.metadata.creationTimestamp ?? '').localeCompare(
    a.lastTimestamp ?? a.eventTime ?? a.metadata.creationTimestamp ?? ''
  );

const Lists = React.memo(function Lists({ onData, pick }: { onData: (d: Omit<KubeData, 'refresh' | 'cluster'>) => void; pick: string }) {
  const R = K8s.ResourceClasses as any;
  const slow = { refetchInterval: 30000 };
  const cephClusters = useList(CephCluster, { refetchInterval: 15000 });
  const chosen =
    cephClusters.items.find(c => `${c.metadata.namespace}/${c.metadata.name}` === pick) ??
    [...cephClusters.items].sort((a, b) => (a.metadata.creationTimestamp ?? '').localeCompare(b.metadata.creationTimestamp ?? ''))[0] ??
    null;
  const ns = chosen?.metadata.namespace ?? 'rook-ceph';
  const inNs = { namespace: ns, ...slow };
  const blockPools = useList(CephBlockPool, { refetchInterval: 15000 });
  const radosNamespaces = useList(CephBlockPoolRadosNamespace, slow);
  const filesystems = useList(CephFilesystem, slow);
  const subVolumeGroups = useList(CephFilesystemSubVolumeGroup, slow);
  const fsMirrors = useList(CephFilesystemMirror, slow);
  const objectStores = useList(CephObjectStore, slow);
  const objectUsers = useList(CephObjectStoreUser, slow);
  const objectZones = useList(CephObjectZone, slow);
  const bucketClaims = useList(ObjectBucketClaim, slow);
  const clients = useList(CephClient, slow);
  const nfs = useList(CephNFS, slow);
  const rbdMirrors = useList(CephRBDMirror, slow);
  const nvmeof = useList(CephNVMeOFGateway, slow);
  const storageClasses = useList(R.StorageClass, { refetchInterval: 15000 });
  const snapshotClasses = useList(VolumeSnapshotClass, { refetchInterval: 15000 });
  const pvs = useList(R.PersistentVolume, { refetchInterval: 20000 });
  const pvcs = useList(R.PersistentVolumeClaim, { refetchInterval: 20000 });
  const csiDrivers = useList(CsiDriver, slow);
  const nodes = useList(R.Node, slow);
  const namespaces = useList(R.Namespace, { refetchInterval: 60000 });
  const rookPods = useList(R.Pod, { namespace: ns });
  const events = useList(KubeEvent, { namespace: ns, refetchInterval: 15000 });
  const deployments = useList(R.Deployment, inNs);
  const daemonSets = useList(R.DaemonSet, inNs);

  const data = React.useMemo(
    () => ({
      cephClusters,
      cephCluster: chosen,
      ns,
      blockPools,
      radosNamespaces,
      filesystems,
      subVolumeGroups,
      fsMirrors,
      objectStores,
      objectUsers,
      objectZones,
      bucketClaims,
      clients,
      nfs,
      rbdMirrors,
      nvmeof,
      storageClasses,
      snapshotClasses,
      pvs,
      pvcs,
      csiDrivers,
      nodes,
      namespaces,
      rookPods,
      events: { ...events, items: [...events.items].sort(byTimeDesc) },
      deployments,
      daemonSets,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      cephClusters,
      chosen,
      ns,
      blockPools,
      radosNamespaces,
      filesystems,
      subVolumeGroups,
      fsMirrors,
      objectStores,
      objectUsers,
      objectZones,
      bucketClaims,
      clients,
      nfs,
      rbdMirrors,
      nvmeof,
      storageClasses,
      snapshotClasses,
      pvs,
      pvcs,
      csiDrivers,
      nodes,
      namespaces,
      rookPods,
      events,
      deployments,
      daemonSets,
    ]
  );
  React.useEffect(() => onData(data), [data, onData]);
  return null;
});

const EMPTY_LIST: ListState = { items: [], error: null, loaded: false, missing: false, forbidden: false };

function empty(cluster: string, refresh: () => void): KubeData {
  const l = EMPTY_LIST;
  return {
    cluster,
    cephClusters: l,
    cephCluster: null,
    ns: 'rook-ceph',
    blockPools: l,
    radosNamespaces: l,
    filesystems: l,
    subVolumeGroups: l,
    fsMirrors: l,
    objectStores: l,
    objectUsers: l,
    objectZones: l,
    bucketClaims: l,
    clients: l,
    nfs: l,
    rbdMirrors: l,
    nvmeof: l,
    storageClasses: l,
    snapshotClasses: l,
    pvs: l,
    pvcs: l,
    csiDrivers: l,
    nodes: l,
    namespaces: l,
    rookPods: l,
    events: l,
    deployments: l,
    daemonSets: l,
    refresh,
  };
}

export function KubeProvider({ children }: { children: React.ReactNode }) {
  const cluster = currentCluster();
  const [settings] = useSettings();
  const [gen, setGen] = React.useState(0);
  const [data, setData] = React.useState<Omit<KubeData, 'refresh' | 'cluster'> | null>(null);
  const refresh = React.useCallback(() => setGen(g => g + 1), []);
  // After refresh() the lists remount: keep showing what was loaded until the new answers arrive.
  const onData = React.useCallback((next: Omit<KubeData, 'refresh' | 'cluster'>) => setData(prev => keepLoaded(prev, next)), []);
  const value = React.useMemo<KubeData>(() => (data ? { ...data, cluster, refresh } : empty(cluster, refresh)), [data, cluster, refresh]);
  return (
    <>
      <Lists key={`${cluster}-${gen}`} onData={onData} pick={settings.cluster} />
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </>
  );
}

type Data = Omit<KubeData, 'refresh' | 'cluster'>;

function keepLoaded(prev: Data | null, next: Data): Data {
  if (!prev) return next;
  const out: any = { ...next };
  for (const [k, v] of Object.entries(next)) {
    const p = (prev as any)[k];
    if (v && typeof v === 'object' && 'loaded' in v && !(v as ListState).loaded && p?.loaded) out[k] = p;
  }
  if (!next.cephClusters.loaded && prev.cephClusters.loaded) {
    out.cephCluster = prev.cephCluster;
    out.ns = prev.ns;
  }
  return out as Data;
}

/** Every pod of the cluster, polled (for "who uses this volume"). Only mounted where needed. */
export function useAllPods(enabled = true): ListState {
  const R = K8s.ResourceClasses as any;
  return useList(R.Pod, enabled ? { refetchInterval: 30000 } : { namespace: '__none__', refetchInterval: 600000 });
}
