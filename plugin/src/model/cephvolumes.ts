/*
 * Kubernetes volumes backed by Ceph: each PersistentVolume made by a Ceph
 * CSI driver with its claim, and claims of a Ceph class still waiting for
 * one; where the data lives (pool and RBD image, or CephFS subvolume) and
 * who uses it (pods, and KubeVirt VMs through their virt-launcher pods).
 */

import { CephCsiKind, cephKindOf, parseQuantity } from './storageclass';
import { Obj } from './types';

export interface Consumer {
  /** The pod that mounts the claim. */
  pod: string;
  namespace: string;
  /** The KubeVirt VM behind a virt-launcher pod. */
  vm?: string;
  node?: string;
  phase: string;
}

export interface VolumeRow {
  key: string;
  pv?: Obj;
  pvc?: Obj;
  pvName?: string;
  claimNs?: string;
  claimName?: string;
  storageClass?: string;
  kind: CephCsiKind | null;
  driver?: string;
  sizeBytes: number;
  accessModes: string[];
  volumeMode: string;
  /** Bound, Pending, Released, Failed, Lost, Available. */
  status: string;
  clusterID?: string;
  pool?: string;
  radosNamespace?: string;
  image?: string;
  fsName?: string;
  subvolume?: string;
  subvolumePath?: string;
  consumers: Consumer[];
}

const SHORT: Record<string, string> = {
  ReadWriteOnce: 'RWO',
  ReadWriteMany: 'RWX',
  ReadOnlyMany: 'ROX',
  ReadWriteOncePod: 'RWOP',
};

export const shortMode = (m: string) => SHORT[m] ?? m;

const claimKey = (ns?: string, name?: string) => `${ns ?? ''}/${name ?? ''}`;

/** Claims → pods that mount them (with the VM of virt-launcher pods). */
export function consumersByClaim(pods: Obj[]): Map<string, Consumer[]> {
  const m = new Map<string, Consumer[]>();
  for (const p of pods) {
    if (p.status?.phase === 'Succeeded' || p.status?.phase === 'Failed') continue;
    const labels = p.metadata.labels ?? {};
    const vm = labels['vm.kubevirt.io/name'] ?? labels['kubevirt.io/domain'];
    for (const v of p.spec?.volumes ?? []) {
      const claim = v?.persistentVolumeClaim?.claimName;
      if (!claim) continue;
      const k = claimKey(p.metadata.namespace, claim);
      const list = m.get(k) ?? [];
      list.push({ pod: p.metadata.name, namespace: p.metadata.namespace ?? '', vm, node: p.spec?.nodeName, phase: p.status?.phase ?? 'Unknown' });
      m.set(k, list);
    }
  }
  return m;
}

/** Ceph volumes: PVs from a Ceph CSI driver (or class), and pending claims of Ceph classes. */
export function cephVolumes(pvs: Obj[], pvcs: Obj[], scs: Obj[], pods?: Obj[]): VolumeRow[] {
  const classKind = new Map<string, CephCsiKind>();
  for (const sc of scs) {
    const k = cephKindOf(sc.provisioner);
    if (k) classKind.set(sc.metadata.name, k);
  }
  const claims = new Map(pvcs.map(c => [claimKey(c.metadata.namespace, c.metadata.name), c]));
  const users = pods ? consumersByClaim(pods) : new Map<string, Consumer[]>();
  const rows: VolumeRow[] = [];
  const seenClaims = new Set<string>();
  for (const pv of pvs) {
    const driver = pv.spec?.csi?.driver as string | undefined;
    const kind = cephKindOf(driver) ?? classKind.get(pv.spec?.storageClassName) ?? null;
    if (!kind) continue;
    const a = pv.spec?.csi?.volumeAttributes ?? {};
    const ref = pv.spec?.claimRef;
    const ck = ref?.name ? claimKey(ref.namespace, ref.name) : '';
    // A claimRef from an older claim of the same name does not count.
    const pvc = ck ? claims.get(ck) : undefined;
    const pvcMatches = pvc && (!ref?.uid || !pvc.metadata.uid || ref.uid === pvc.metadata.uid) ? pvc : undefined;
    if (ck) seenClaims.add(ck);
    rows.push({
      key: `pv/${pv.metadata.name}`,
      pv,
      pvc: pvcMatches,
      pvName: pv.metadata.name,
      claimNs: ref?.namespace,
      claimName: ref?.name,
      storageClass: pv.spec?.storageClassName || undefined,
      kind,
      driver,
      sizeBytes: parseQuantity(pv.spec?.capacity?.storage),
      accessModes: pv.spec?.accessModes ?? [],
      volumeMode: pv.spec?.volumeMode ?? 'Filesystem',
      status: pv.status?.phase ?? 'Unknown',
      clusterID: a.clusterID,
      pool: a.pool,
      radosNamespace: a.radosNamespace || undefined,
      image: a.imageName,
      fsName: a.fsName,
      subvolume: a.subvolumeName,
      subvolumePath: a.subvolumePath,
      consumers: ck && pvcMatches ? users.get(ck) ?? [] : [],
    });
  }
  for (const c of pvcs) {
    const k = claimKey(c.metadata.namespace, c.metadata.name);
    if (seenClaims.has(k)) continue;
    const kind = classKind.get(c.spec?.storageClassName);
    if (!kind) continue;
    if (c.spec?.volumeName && c.status?.phase === 'Bound') continue; // its PV is not readable or not Ceph
    rows.push({
      key: `pvc/${k}`,
      pvc: c,
      claimNs: c.metadata.namespace,
      claimName: c.metadata.name,
      pvName: c.spec?.volumeName || undefined,
      storageClass: c.spec?.storageClassName,
      kind,
      sizeBytes: parseQuantity(c.spec?.resources?.requests?.storage),
      accessModes: c.spec?.accessModes ?? [],
      volumeMode: c.spec?.volumeMode ?? 'Filesystem',
      status: c.status?.phase ?? 'Pending',
      consumers: users.get(k) ?? [],
    });
  }
  return rows.sort((x, y) => `${x.claimNs ?? '~'}/${x.claimName ?? x.pvName}`.localeCompare(`${y.claimNs ?? '~'}/${y.claimName ?? y.pvName}`));
}

export interface VolumeFilter {
  q?: string;
  storageClass?: string;
  status?: string;
  /** "vm": used by a VM; "pod": used by pods only; "idle": nobody mounts it. */
  use?: 'vm' | 'pod' | 'idle' | '';
}

export function filterVolumes(rows: VolumeRow[], f: VolumeFilter): VolumeRow[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return rows.filter(r => {
    if (f.storageClass && r.storageClass !== f.storageClass) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.use === 'vm' && !r.consumers.some(c => c.vm)) return false;
    if (f.use === 'pod' && (!r.consumers.length || r.consumers.some(c => c.vm))) return false;
    if (f.use === 'idle' && r.consumers.length) return false;
    if (!q) return true;
    const hay = [r.claimNs, r.claimName, r.pvName, r.storageClass, r.pool, r.image, r.fsName, r.subvolume, ...r.consumers.flatMap(c => [c.pod, c.vm, c.node])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return q.split(/\s+/).every(w => hay.includes(w));
  });
}

export function statusTone(s: string): 'ok' | 'warn' | 'err' | 'idle' | 'move' {
  if (s === 'Bound') return 'ok';
  if (s === 'Pending') return 'move';
  if (s === 'Released' || s === 'Available') return 'warn';
  if (s === 'Failed' || s === 'Lost') return 'err';
  return 'idle';
}

/** Totals for the summary line. */
export function volumeTotals(rows: VolumeRow[]) {
  return {
    count: rows.length,
    bytes: rows.reduce((n, r) => n + r.sizeBytes, 0),
    vms: new Set(rows.flatMap(r => r.consumers.filter(c => c.vm).map(c => `${c.namespace}/${c.vm}`))).size,
    idle: rows.filter(r => r.status === 'Bound' && !r.consumers.length).length,
    notBound: rows.filter(r => r.status !== 'Bound').length,
  };
}
