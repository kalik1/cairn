/*
 * StorageClasses, snapshot classes and volumes backed by Ceph, in the words
 * an administrator uses: what a class gives (block volumes, filesystem
 * volumes on RBD, a shared CephFS filesystem, object buckets), where its
 * data lives, how many volumes use it. Plus the StorageClass wizard: presets,
 * the defaults it learns from the cluster (CSI driver, clusterID, CSI secret
 * names), the objects it builds and their validation.
 *
 * Pure functions over plain Kubernetes JSON; the views add the live parts.
 */

import { Obj } from './types';

/* --------------------------------------------------------------- kinds */

export type CephCsiKind = 'rbd' | 'cephfs' | 'nfs' | 'bucket';

/** Which Ceph driver a provisioner (or snapshot driver) name is, or null when it is not Ceph. */
export function cephKindOf(provisioner?: string | null): CephCsiKind | null {
  if (!provisioner) return null;
  if (/(^|\.)rbd\.csi\.ceph\.com$/.test(provisioner)) return 'rbd';
  if (/(^|\.)cephfs\.csi\.ceph\.com$/.test(provisioner)) return 'cephfs';
  if (/(^|\.)nfs\.csi\.ceph\.com$/.test(provisioner)) return 'nfs';
  if (/(^|\.)ceph\.rook\.io\/bucket$/.test(provisioner)) return 'bucket';
  return null;
}

export const KIND_WORDS: Record<CephCsiKind, string> = {
  rbd: 'RBD volumes',
  cephfs: 'Shared filesystem (CephFS)',
  nfs: 'NFS exports',
  bucket: 'Object buckets',
};

/** Annotation the wizard leaves on classes it creates (the preset used). */
export const PRESET_ANNOTATION = 'cairn.magesgate.com/preset';
export const DEFAULT_CLASS_ANNOTATION = 'storageclass.kubernetes.io/is-default-class';
const DEFAULT_CLASS_BETA = 'storageclass.beta.kubernetes.io/is-default-class';
export const DEFAULT_SNAPSHOT_ANNOTATION = 'snapshot.storage.k8s.io/is-default-class';

export function isDefaultClass(sc: Obj): boolean {
  const a = sc.metadata.annotations ?? {};
  return a[DEFAULT_CLASS_ANNOTATION] === 'true' || a[DEFAULT_CLASS_BETA] === 'true';
}

export function isDefaultSnapshotClass(vsc: Obj): boolean {
  return (vsc.metadata.annotations ?? {})[DEFAULT_SNAPSHOT_ANNOTATION] === 'true';
}

/* ------------------------------------------------------------ quantity */

const BIN: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };
const DEC: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

/** A Kubernetes quantity ("10Gi", "1G", "500M", "1.5Ti", "2e9") in bytes; 0 when unreadable. */
export function parseQuantity(q: string | number | null | undefined): number {
  if (q === null || q === undefined) return 0;
  if (typeof q === 'number') return isFinite(q) ? q : 0;
  const m = String(q)
    .trim()
    .match(/^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(Ki|Mi|Gi|Ti|Pi|Ei|[numkMGTPE]?)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const f = BIN[m[2]] ?? DEC[m[2]] ?? 1;
  const v = n * f;
  return isFinite(v) ? Math.round(v) : 0;
}

/* ------------------------------------------------------- class rows */

export interface ClassRow {
  name: string;
  kind: CephCsiKind;
  /** What the class gives, in plain words. */
  words: string;
  provisioner: string;
  clusterID?: string;
  /** RBD pool (or CephFS data pool). */
  pool?: string;
  /** RBD data pool of an erasure-coded class. */
  dataPool?: string;
  fsName?: string;
  objectStore?: string;
  radosNamespace?: string;
  fstype?: string;
  imageFeatures: string[];
  mapOptions?: string;
  mounter?: string;
  reclaim: string;
  binding: string;
  expansion: boolean;
  isDefault: boolean;
  description?: string;
  preset?: string;
  pvCount: number;
  /** Sum of the capacity of the PVs made from it (bytes). */
  capacity: number;
  blockVolumes: number;
  fsVolumes: number;
  /** Ceph snapshot classes that can snapshot its volumes. */
  snapshotClasses: string[];
  obj: Obj;
}

const param = (sc: Obj, k: string): string | undefined => {
  const v = sc.parameters?.[k];
  return v === undefined || v === null || v === '' ? undefined : String(v);
};

/** The words for an RBD class: from the wizard's preset, else from its volumes. */
function rbdWords(preset: string | undefined, block: number, fs: number): string {
  if (preset === 'vm') return 'Block volumes (RBD), for VM disks';
  if (preset === 'fs') return 'Filesystem volumes on RBD';
  if (block && !fs) return 'Block volumes (RBD)';
  if (fs && !block) return 'Filesystem volumes on RBD';
  return 'Block or filesystem volumes (RBD)';
}

/** The PVs made from a class. */
export function pvsOfClass(name: string, pvs: Obj[]): Obj[] {
  return pvs.filter(pv => pv.spec?.storageClassName === name);
}

/** Ceph snapshot classes whose driver (and clusterID, when set) match a class. */
export function snapshotClassesFor(sc: Obj, vscs: Obj[]): Obj[] {
  const cid = param(sc, 'clusterID');
  return vscs.filter(v => v.driver === sc.provisioner && (!v.parameters?.clusterID || !cid || v.parameters.clusterID === cid));
}

export function classRow(sc: Obj, pvs: Obj[], vscs: Obj[]): ClassRow | null {
  const kind = cephKindOf(sc.provisioner);
  if (!kind) return null;
  const mine = pvsOfClass(sc.metadata.name, pvs);
  const block = mine.filter(pv => pv.spec?.volumeMode === 'Block').length;
  const fs = mine.length - block;
  const preset = sc.metadata.annotations?.[PRESET_ANNOTATION];
  const words = kind === 'rbd' ? rbdWords(preset, block, fs) : KIND_WORDS[kind];
  const kindPool = kind === 'bucket' ? undefined : param(sc, 'pool');
  return {
    name: sc.metadata.name,
    kind,
    words,
    provisioner: sc.provisioner,
    clusterID: param(sc, 'clusterID'),
    pool: kindPool,
    dataPool: param(sc, 'dataPool'),
    fsName: param(sc, 'fsName'),
    objectStore: param(sc, 'objectStoreName'),
    radosNamespace: param(sc, 'radosNamespace'),
    fstype: kind === 'rbd' ? param(sc, 'csi.storage.k8s.io/fstype') ?? 'ext4' : param(sc, 'csi.storage.k8s.io/fstype'),
    imageFeatures: (param(sc, 'imageFeatures') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    mapOptions: param(sc, 'mapOptions'),
    mounter: param(sc, 'mounter'),
    reclaim: sc.reclaimPolicy ?? 'Delete',
    binding: sc.volumeBindingMode ?? 'Immediate',
    expansion: !!sc.allowVolumeExpansion,
    isDefault: isDefaultClass(sc),
    description: sc.metadata.annotations?.description,
    preset,
    pvCount: mine.length,
    capacity: mine.reduce((n, pv) => n + parseQuantity(pv.spec?.capacity?.storage), 0),
    blockVolumes: block,
    fsVolumes: fs,
    snapshotClasses: snapshotClassesFor(sc, vscs).map(v => v.metadata.name),
    obj: sc,
  };
}

/** Ceph-backed classes as rows, and how many other classes there are (with their provisioners). */
export function classRows(scs: Obj[], pvs: Obj[], vscs: Obj[]): { rows: ClassRow[]; others: Obj[] } {
  const rows: ClassRow[] = [];
  const others: Obj[] = [];
  for (const sc of scs) {
    const r = classRow(sc, pvs, vscs);
    if (r) rows.push(r);
    else others.push(sc);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, others };
}

export interface SnapRow {
  name: string;
  driver: string;
  kind: CephCsiKind;
  deletionPolicy: string;
  isDefault: boolean;
  clusterID?: string;
  /** Ceph StorageClasses it serves. */
  serves: string[];
  obj: Obj;
}

export function snapshotRows(vscs: Obj[], scs: Obj[]): SnapRow[] {
  const out: SnapRow[] = [];
  for (const v of vscs) {
    const kind = cephKindOf(v.driver);
    if (!kind) continue;
    out.push({
      name: v.metadata.name,
      driver: v.driver,
      kind,
      deletionPolicy: v.deletionPolicy ?? 'Delete',
      isDefault: isDefaultSnapshotClass(v),
      clusterID: v.parameters?.clusterID,
      serves: scs.filter(sc => cephKindOf(sc.provisioner) && snapshotClassesFor(sc, [v]).length).map(sc => sc.metadata.name),
      obj: v,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** What still uses a class: its PVs (any phase) and claims waiting for one. */
export function classUsage(name: string, pvs: Obj[], pvcs: Obj[]): { pvs: Obj[]; pending: Obj[] } {
  const mine = pvsOfClass(name, pvs);
  const pending = pvcs.filter(c => c.spec?.storageClassName === name && !c.spec?.volumeName);
  return { pvs: mine, pending };
}

/** "demo/fedora-rootdisk (pvc-…)" for a PV: the claim it serves, else the PV name. */
export function pvLabel(pv: Obj): string {
  const c = pv.spec?.claimRef;
  return c?.name ? `${c.namespace}/${c.name}` : pv.metadata.name;
}

/* ---------------------------------------------------------- the wizard */

export type PresetId = 'vm' | 'fs' | 'shared';

export interface Preset {
  id: PresetId;
  title: string;
  kind: 'rbd' | 'cephfs';
  /** One line under the title. */
  summary: string;
  /** What claims made from it should ask for. */
  accessModes: string[];
  volumeMode: 'Block' | 'Filesystem';
  /** The facts behind the choice, one line each. */
  details: string[];
}

export const PRESETS: Preset[] = [
  {
    id: 'vm',
    title: 'Disks for virtual machines',
    kind: 'rbd',
    summary: 'RBD images handed to KubeVirt as raw block devices, shared between nodes so VMs can live-migrate.',
    accessModes: ['ReadWriteMany'],
    volumeMode: 'Block',
    details: [
      'Claims ask for volumeMode Block and ReadWriteMany: KubeVirt can live-migrate the VM (CDI picks this from its StorageProfile).',
      'Image features layering, deep-flatten, exclusive-lock, object-map, fast-diff: fast clones, snapshots and diffs.',
      'Mapped with krbd:rxbounce, which Windows and other guests that rewrite buffers in flight need.',
    ],
  },
  {
    id: 'fs',
    title: 'Filesystem volumes',
    kind: 'rbd',
    summary: 'An RBD image formatted with ext4 or xfs and mounted in one pod at a time: databases, app data.',
    accessModes: ['ReadWriteOnce'],
    volumeMode: 'Filesystem',
    details: [
      'Claims ask for ReadWriteOnce and volumeMode Filesystem: one node mounts it at a time.',
      'The CSI driver formats the image on first use with the filesystem chosen here.',
      'Image features layering, exclusive-lock, object-map, fast-diff.',
    ],
  },
  {
    id: 'shared',
    title: 'Shared filesystem',
    kind: 'cephfs',
    summary: 'A CephFS subvolume that many pods on many nodes mount at once, read and write.',
    accessModes: ['ReadWriteMany'],
    volumeMode: 'Filesystem',
    details: [
      'Claims ask for ReadWriteMany: every pod that mounts it sees the same files.',
      'Each claim is a CephFS subvolume with its own quota, in the CSI subvolume group.',
      'Needs a CephFilesystem and the CephFS CSI driver.',
    ],
  },
];

export const VM_IMAGE_FEATURES = 'layering,deep-flatten,exclusive-lock,object-map,fast-diff';
export const FS_IMAGE_FEATURES = 'layering,exclusive-lock,object-map,fast-diff';
export const VM_MAP_OPTIONS = 'krbd:rxbounce';

/** What the wizard knows about the cluster. */
export interface WizardContext {
  /** Namespace of the CephCluster (Rook's default clusterID). */
  ns: string;
  storageClasses: Obj[];
  snapshotClasses: Obj[];
  /** ceph-csi operator Driver CRs (csi.ceph.io). */
  drivers: Obj[];
  /** The Driver list was read (no error): an empty one means no Driver. */
  driversKnown?: boolean;
  /** k4all runs the cluster: it deploys the CephFS driver only while CephFS is on in its addon. */
  k4all?: boolean;
  /** The k4all addon's Storage page, when its plugin is loaded. */
  k4allAddonUrl?: string | null;
  /** Kubernetes CSIDriver objects (storage.k8s.io), when readable. */
  csiDrivers?: Obj[];
  filesystems: Obj[];
  blockPools: Obj[];
}

export interface DriverGuess {
  provisioner: string;
  /** Where the name came from: a ceph-csi Driver, a CSIDriver, an existing class, or a guess. */
  source: 'driver' | 'csidriver' | 'class' | 'guess';
  /** The driver is known to be deployed (a Driver CR or a CSIDriver object). */
  deployed: boolean;
}

export function detectDriver(ctx: WizardContext, kind: 'rbd' | 'cephfs'): DriverGuess {
  const ofKind = (n?: string) => cephKindOf(n) === kind;
  // Prefer the driver of the CephCluster's namespace (Rook names it <operator-ns>.<kind>.csi.ceph.com).
  const pref = (names: string[]) => names.find(n => n.startsWith(`${ctx.ns}.`)) ?? names[0];
  const drv = pref(ctx.drivers.map(d => d.metadata.name).filter(ofKind));
  if (drv) return { provisioner: drv, source: 'driver', deployed: true };
  const csi = pref((ctx.csiDrivers ?? []).map(d => d.metadata.name).filter(ofKind));
  if (csi) return { provisioner: csi, source: 'csidriver', deployed: true };
  const cls = pref(ctx.storageClasses.map(s => s.provisioner as string).filter(ofKind));
  if (cls) return { provisioner: cls, source: 'class', deployed: false };
  return { provisioner: `${ctx.ns}.${kind}.csi.ceph.com`, source: 'guess', deployed: false };
}

/** An existing class of the same driver to copy the clusterID and CSI secret names from. */
export function templateClass(ctx: WizardContext, provisioner: string): Obj | undefined {
  const same = ctx.storageClasses.filter(s => s.provisioner === provisioner);
  return same.find(s => s.parameters?.clusterID === ctx.ns) ?? same[0];
}

const SECRET_KEY = /^csi\.storage\.k8s\.io\/[a-z-]+-secret-(name|namespace)$/;

/** Rook's own CSI secret names, for a cluster without a class to learn from. */
export function defaultSecrets(kind: 'rbd' | 'cephfs', ns: string): Record<string, string> {
  const prov = kind === 'rbd' ? 'rook-csi-rbd-provisioner' : 'rook-csi-cephfs-provisioner';
  const node = kind === 'rbd' ? 'rook-csi-rbd-node' : 'rook-csi-cephfs-node';
  return {
    'csi.storage.k8s.io/provisioner-secret-name': prov,
    'csi.storage.k8s.io/provisioner-secret-namespace': ns,
    'csi.storage.k8s.io/controller-expand-secret-name': prov,
    'csi.storage.k8s.io/controller-expand-secret-namespace': ns,
    'csi.storage.k8s.io/node-stage-secret-name': node,
    'csi.storage.k8s.io/node-stage-secret-namespace': ns,
  };
}

/** The CSI secret parameters of a class (names and namespaces only: never the secrets). */
export function secretParams(sc: Obj | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sc?.parameters ?? {})) if (SECRET_KEY.test(k)) out[k] = String(v);
  return out;
}

export interface ClassForm {
  preset: PresetId;
  name: string;
  description: string;
  provisioner: string;
  clusterID: string;
  /** RBD pool, or CephFS data pool (optional). */
  pool: string;
  fsName: string;
  fstype: 'ext4' | 'xfs';
  imageFeatures: string;
  mapOptions: string;
  /** csi.storage.k8s.io/*-secret-name|namespace parameters. */
  secrets: Record<string, string>;
  reclaimPolicy: 'Delete' | 'Retain';
  bindingMode: 'Immediate' | 'WaitForFirstConsumer';
  allowExpansion: boolean;
  makeDefault: boolean;
  snapshot: { create: boolean; name: string; deletionPolicy: 'Delete' | 'Retain'; makeDefault: boolean };
  /** Where the defaults came from, for the form to explain. */
  learnedFrom?: string;
  driverSource?: DriverGuess['source'];
}

export function presetById(id: PresetId): Preset {
  return PRESETS.find(p => p.id === id) ?? PRESETS[0];
}

/** Why CephFS classes cannot provision on k4all now: its addon has CephFS off. */
export const K4ALL_CEPHFS_OFF =
  'k4all runs the CephFS CSI driver only while CephFS is on: turn CephFS on in the k4all addon (Storage), then come back for the class. A class made now would never provision.';

/**
 * Whether a preset can be used on this cluster, and why not. `k4allAddon`:
 * the way out is in the k4all addon.
 */
export function presetAvailability(ctx: WizardContext, id: PresetId): { ok: boolean; reason?: string; k4allAddon?: boolean } {
  const p = presetById(id);
  if (p.kind === 'cephfs') {
    // k4all v2.7.2 and later remove the ceph-csi Driver of CephFS while CephFS
    // is off (no filesystem wanted, no CephFS volume left), even where a
    // CephFilesystem, its CSIDriver or a class of it remain.
    if (ctx.k4all && ctx.driversKnown && detectDriver(ctx, 'cephfs').source !== 'driver') return { ok: false, reason: K4ALL_CEPHFS_OFF, k4allAddon: true };
    if (!ctx.filesystems.length)
      return { ok: false, reason: 'There is no CephFilesystem. Create one under File first, then come back for the class.' };
    const d = detectDriver(ctx, 'cephfs');
    if (!d.deployed && d.source !== 'class')
      return {
        ok: false,
        reason:
          'The CephFS CSI driver is not deployed (no *.cephfs.csi.ceph.com Driver or CSIDriver). Enable it in the Rook operator settings (csi.enableCephfsDriver, or the ceph-csi-drivers chart) first.',
      };
    return { ok: true };
  }
  if (!ctx.blockPools.length) return { ok: false, reason: 'There is no CephBlockPool. Create a pool first, then come back for the class.' };
  return { ok: true };
}

/** Rook's name of a CephFilesystem's data pools ("myfs-data0", or "myfs-<name>"). */
export function fsDataPools(fs: Obj): string[] {
  const name = fs.metadata.name;
  return (fs.spec?.dataPools ?? []).map((p: any, i: number) => (p?.name ? `${name}-${p.name}` : `${name}-data${i}`));
}

/** A class name nobody uses yet, from a base. */
export function freeName(base: string, taken: string[]): string {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
      .slice(0, 60) || 'ceph';
  if (!taken.includes(clean)) return clean;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${clean}-${i}`)) return `${clean}-${i}`;
  return `${clean}-${Date.now().toString(36)}`;
}

/** The form for a preset, filled from what the cluster already has. */
export function defaultForm(ctx: WizardContext, id: PresetId, pick?: { pool?: string; fsName?: string }): ClassForm {
  const p = presetById(id);
  const drv = detectDriver(ctx, p.kind);
  const tpl = templateClass(ctx, drv.provisioner);
  const secrets = Object.keys(secretParams(tpl)).length ? secretParams(tpl) : defaultSecrets(p.kind, ctx.ns);
  const taken = ctx.storageClasses.map(s => s.metadata.name);
  const fs = ctx.filesystems.find(f => f.metadata.name === pick?.fsName) ?? ctx.filesystems[0];
  const pool = p.kind === 'rbd' ? pick?.pool ?? ctx.blockPools[0]?.metadata.name ?? '' : '';
  const fsName = p.kind === 'cephfs' ? fs?.metadata.name ?? '' : '';
  const base = p.kind === 'rbd' ? `${pool || 'ceph'}-${id === 'vm' ? 'vm' : 'fs'}` : `${fsName || 'cephfs'}-shared`;
  const name = freeName(base, taken);
  const vscTaken = ctx.snapshotClasses.map(s => s.metadata.name);
  return {
    preset: id,
    name,
    description:
      id === 'vm'
        ? `VM disks on Ceph RBD pool ${pool} (shared: VMs can live-migrate)`
        : id === 'fs'
        ? `Filesystem volumes on Ceph RBD pool ${pool}`
        : `Shared CephFS filesystem ${fsName}`,
    provisioner: drv.provisioner,
    clusterID: tpl?.parameters?.clusterID ?? ctx.ns,
    pool,
    fsName,
    fstype: 'ext4',
    imageFeatures: id === 'vm' ? VM_IMAGE_FEATURES : FS_IMAGE_FEATURES,
    mapOptions: id === 'vm' ? VM_MAP_OPTIONS : '',
    secrets,
    reclaimPolicy: 'Delete',
    bindingMode: id === 'vm' ? 'Immediate' : 'WaitForFirstConsumer',
    allowExpansion: true,
    makeDefault: false,
    snapshot: {
      create: !ctx.snapshotClasses.some(v => v.driver === drv.provisioner),
      name: freeName(`${name}-snapshot`, vscTaken),
      deletionPolicy: 'Delete',
      makeDefault: false,
    },
    learnedFrom: tpl?.metadata.name,
    driverSource: drv.source,
  };
}

/** The StorageClass the form describes. */
export function buildStorageClass(f: ClassForm): Obj {
  const p = presetById(f.preset);
  const params: Record<string, string> = { clusterID: f.clusterID };
  if (p.kind === 'rbd') {
    params.pool = f.pool;
    params.imageFormat = '2';
    params.imageFeatures = f.imageFeatures;
    if (f.mapOptions) params.mapOptions = f.mapOptions;
  } else {
    params.fsName = f.fsName;
    if (f.pool) params.pool = f.pool;
  }
  Object.assign(params, f.secrets);
  // RBD volumes in Block mode ignore it; Filesystem ones are formatted with it.
  if (p.kind === 'rbd') params['csi.storage.k8s.io/fstype'] = f.fstype;
  const annotations: Record<string, string> = { [PRESET_ANNOTATION]: f.preset };
  if (f.description.trim()) annotations.description = f.description.trim();
  if (f.makeDefault) annotations[DEFAULT_CLASS_ANNOTATION] = 'true';
  return {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: { name: f.name, annotations },
    provisioner: f.provisioner,
    parameters: params,
    reclaimPolicy: f.reclaimPolicy,
    volumeBindingMode: f.bindingMode,
    allowVolumeExpansion: f.allowExpansion,
  };
}

/** The VolumeSnapshotClass for the same driver, when asked for. */
export function buildSnapshotClass(f: ClassForm): Obj | null {
  if (!f.snapshot.create) return null;
  const p = presetById(f.preset);
  const ns = f.secrets['csi.storage.k8s.io/provisioner-secret-namespace'] ?? f.clusterID;
  const name =
    f.secrets['csi.storage.k8s.io/provisioner-secret-name'] ?? (p.kind === 'rbd' ? 'rook-csi-rbd-provisioner' : 'rook-csi-cephfs-provisioner');
  const annotations: Record<string, string> = {};
  if (f.snapshot.makeDefault) annotations[DEFAULT_SNAPSHOT_ANNOTATION] = 'true';
  return {
    apiVersion: 'snapshot.storage.k8s.io/v1',
    kind: 'VolumeSnapshotClass',
    metadata: { name: f.snapshot.name, ...(Object.keys(annotations).length ? { annotations } : {}) },
    driver: f.provisioner,
    parameters: {
      clusterID: f.clusterID,
      'csi.storage.k8s.io/snapshotter-secret-name': name,
      'csi.storage.k8s.io/snapshotter-secret-namespace': ns,
    },
    deletionPolicy: f.snapshot.deletionPolicy,
  };
}

/** Is it a valid Kubernetes object name (DNS-1123 subdomain)? Returns the problem, or null. */
export function nameProblem(name: string): string | null {
  if (!name) return 'Give it a name.';
  if (name.length > 253) return 'At most 253 characters.';
  if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(name)) return 'Lowercase letters, digits, "-" and "."; start and end with a letter or digit.';
  return null;
}

const FEATURES = ['layering', 'striping', 'exclusive-lock', 'object-map', 'fast-diff', 'deep-flatten', 'journaling', 'data-pool'];

/** Problems with the form, by field (empty when it can be created). */
export function validateClassForm(f: ClassForm, ctx: WizardContext): Record<string, string> {
  const e: Record<string, string> = {};
  const p = presetById(f.preset);
  const n = nameProblem(f.name);
  if (n) e.name = n;
  else if (ctx.storageClasses.some(s => s.metadata.name === f.name)) e.name = `A StorageClass named ${f.name} exists already.`;
  if (!f.provisioner.trim()) e.provisioner = 'The CSI driver name is needed.';
  else if (cephKindOf(f.provisioner) !== p.kind) e.provisioner = `This preset needs a ${p.kind === 'rbd' ? '*.rbd.csi.ceph.com' : '*.cephfs.csi.ceph.com'} driver.`;
  if (!f.clusterID.trim()) e.clusterID = 'The clusterID is needed (the namespace of the CephCluster with Rook).';
  if (p.kind === 'rbd') {
    if (!f.pool) e.pool = 'Choose the pool the images go to.';
    const bad = f.imageFeatures
      .split(',')
      .map(s => s.trim())
      .filter(s => s && !FEATURES.includes(s));
    if (bad.length) e.imageFeatures = `Unknown image feature: ${bad.join(', ')}.`;
    else if (!f.imageFeatures.split(',').some(s => s.trim() === 'layering')) e.imageFeatures = 'Keep layering: the CSI driver needs it for clones and snapshots.';
    const feats = f.imageFeatures.split(',').map(s => s.trim());
    if ((feats.includes('object-map') || feats.includes('fast-diff')) && !feats.includes('exclusive-lock'))
      e.imageFeatures = 'object-map and fast-diff need exclusive-lock.';
  } else if (!f.fsName) e.fsName = 'Choose the CephFilesystem.';
  for (const [k, v] of Object.entries(f.secrets))
    if (!v.trim()) e.secrets = `${k.replace('csi.storage.k8s.io/', '')} is empty.`;
  if (f.snapshot.create) {
    const sn = nameProblem(f.snapshot.name);
    if (sn) e.snapshotName = sn;
    else if (ctx.snapshotClasses.some(s => s.metadata.name === f.snapshot.name))
      e.snapshotName = `A VolumeSnapshotClass named ${f.snapshot.name} exists already.`;
  }
  return e;
}

/** What creating the class means, one line each (for the change preview). */
export function classConsequences(f: ClassForm, ctx: WizardContext): string[] {
  const p = presetById(f.preset);
  const out: string[] = [];
  out.push(
    p.kind === 'rbd'
      ? `Each claim becomes an RBD image in pool ${f.pool}, made by ${f.provisioner}.`
      : `Each claim becomes a CephFS subvolume in ${f.fsName}, made by ${f.provisioner}.`
  );
  out.push(`Claims should ask for ${p.accessModes.join(', ')} and volumeMode ${p.volumeMode}.`);
  out.push(
    f.reclaimPolicy === 'Delete'
      ? 'Deleting a claim deletes its data in Ceph (reclaim policy Delete).'
      : 'Deleting a claim keeps its data in Ceph (reclaim policy Retain): remove released volumes by hand.'
  );
  if (f.makeDefault) {
    const cur = ctx.storageClasses.filter(isDefaultClass).map(s => s.metadata.name);
    out.push(
      cur.length
        ? `It becomes a default class next to ${cur.join(', ')}: claims without a class then pick the newest default. Remove the annotation from the old one.`
        : 'It becomes the default class: claims without a storageClassName use it.'
    );
  }
  return out;
}
