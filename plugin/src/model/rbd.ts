/*
 * RBD images: the shapes of the bridge's "rbd_images" answer and of
 * "rbd du", feature and flag decoding, the image → PV → PVC → pod / VM
 * mapping, and the safety rules for snapshots, rollbacks, resizes and the
 * trash (what may be done to an image, and why not).
 */

import { cephTime } from './format';
import { Obj } from './types';

export interface RbdSnap {
  id: number;
  name: string;
  size: number;
  protected: boolean | null;
  time: number | null;
  /** Snapshot namespace type: 0 user, 1 group, 2 trash, 3 mirror. */
  nsType: number | null;
}

export interface RbdRef {
  pool: string;
  ns: string;
  image: string;
  snap?: string;
  trash?: boolean;
}

export interface RbdImage {
  name: string;
  id: string;
  size: number;
  objSize: number;
  numObjs: number;
  order: number;
  prefix: string;
  features: number;
  flags: number;
  opFeatures: number;
  created: number | null;
  modified: number | null;
  dataPoolId: number | null;
  parent?: RbdRef;
  snaps: RbdSnap[];
  children: RbdRef[];
  watchers?: { addr: string; id: number }[];
  /** The image could not be opened. */
  error?: string;
}

export interface RbdTrashEntry {
  id: string;
  name: string;
  /** "USER", "MIRRORING", "MIGRATION", "REMOVING" or a number. */
  source: string;
  deleted: number | null;
  deferredUntil: number | null;
}

const n = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)) ? Number(v) : d);
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const SOURCES: Record<number, string> = { 0: 'USER', 1: 'MIRRORING', 2: 'MIGRATION', 3: 'REMOVING', 4: 'USER_PARENT' };

/** The bridge's rbd_images answer. */
export function parseRbdImages(out: any): { images: RbdImage[]; trash: RbdTrashEntry[]; namespaces: string[] | null } {
  const o = out && typeof out === 'object' ? out : {};
  const images: RbdImage[] = (Array.isArray(o.images) ? o.images : []).map((i: any) => ({
    name: s(i.name),
    id: s(i.id),
    size: n(i.size),
    objSize: n(i.obj_size),
    numObjs: n(i.num_objs),
    order: n(i.order),
    prefix: s(i.prefix),
    features: n(i.features),
    flags: n(i.flags),
    opFeatures: n(i.op_features),
    created: cephTime(i.created),
    modified: cephTime(i.modified),
    dataPoolId: i.data_pool_id === undefined || i.data_pool_id === null ? null : n(i.data_pool_id, -1),
    parent: i.parent ? { pool: s(i.parent.pool), ns: s(i.parent.ns), image: s(i.parent.image), snap: s(i.parent.snap) } : undefined,
    snaps: (Array.isArray(i.snaps) ? i.snaps : []).map((x: any) => ({
      id: n(x.id),
      name: s(x.name),
      size: n(x.size),
      protected: x.protected === null || x.protected === undefined ? null : !!x.protected,
      time: cephTime(x.time),
      nsType: x.ns_type === null || x.ns_type === undefined ? null : n(x.ns_type),
    })),
    children: (Array.isArray(i.children) ? i.children : []).map((c: any) => ({ pool: s(c.pool), ns: s(c.ns), image: s(c.image), trash: !!c.trash })),
    watchers: Array.isArray(i.watchers) ? i.watchers.map((w: any) => ({ addr: s(w.addr), id: n(w.id) })) : undefined,
    error: i.error ? s(i.error) : undefined,
  }));
  const trash: RbdTrashEntry[] = (Array.isArray(o.trash) ? o.trash : []).map((t: any) => ({
    id: s(t.id),
    name: s(t.name),
    source: typeof t.source === 'number' ? SOURCES[t.source] ?? String(t.source) : s(t.source),
    deleted: cephTime(t.deleted),
    deferredUntil: cephTime(t.deferred_until),
  }));
  const namespaces = Array.isArray(o.namespaces) ? o.namespaces.map(s).filter(Boolean) : null;
  return { images, trash, namespaces };
}

/**
 * "rbd du --format json": provisioned and used bytes per image and per
 * snapshot ("image@snap"). With snapshots, Ceph counts each snapshot's
 * blocks written since the previous one, and the image (head) only what
 * changed since the last snapshot: the sum is what the image occupies.
 */
export function parseRbdDu(out: any): {
  byImage: Map<string, { provisioned: number; used: number }>;
  bySnap: Map<string, number>;
  provisioned: number;
  used: number;
} {
  const o = out && typeof out === 'object' ? out : {};
  const byImage = new Map<string, { provisioned: number; used: number }>();
  const bySnap = new Map<string, number>();
  for (const i of Array.isArray(o.images) ? o.images : []) {
    const k = s(i.name);
    if (i.snapshot) bySnap.set(`${k}@${s(i.snapshot)}`, n(i.used_size));
    else byImage.set(k, { provisioned: n(i.provisioned_size), used: n(i.used_size) });
  }
  return { byImage, bySnap, provisioned: n(o.total_provisioned_size), used: n(o.total_used_size) };
}

/* -------------------------------------------------------------- features */

export interface Feature {
  bit: number;
  name: string;
  about: string;
}

export const FEATURES: Feature[] = [
  { bit: 1, name: 'layering', about: 'Clones: copy-on-write children of a protected snapshot.' },
  { bit: 2, name: 'striping', about: 'Custom striping across objects (stripe unit and count).' },
  { bit: 4, name: 'exclusive-lock', about: 'One client writes at a time; needed by object-map, fast-diff and journaling.' },
  { bit: 8, name: 'object-map', about: 'Tracks which objects exist: faster resize, export, delete and du.' },
  { bit: 16, name: 'fast-diff', about: 'Fast used-space and diff calculation from the object map.' },
  { bit: 32, name: 'deep-flatten', about: 'Clones can be flattened including their snapshots.' },
  { bit: 64, name: 'journaling', about: 'Every write is journaled first: needed for journal-based mirroring, slower writes.' },
  { bit: 128, name: 'data-pool', about: 'Data lives in a separate pool (an erasure-coded data pool).' },
  { bit: 256, name: 'operations', about: 'Restricts old clients from certain operations.' },
  { bit: 512, name: 'migrating', about: 'The image is being live-migrated.' },
  { bit: 1024, name: 'non-primary', about: 'A non-primary mirror copy: read-only here.' },
  { bit: 2048, name: 'dirty-cache', about: 'A persistent write-back cache holds unflushed data.' },
];

/** Feature bits → named features (unknown bits as "bit N"). */
export function decodeFeatures(bits: number): Feature[] {
  const out = FEATURES.filter(f => (bits & f.bit) !== 0);
  let rest = bits;
  FEATURES.forEach(f => (rest &= ~f.bit));
  for (let b = 1; rest > 0 && b < 2 ** 31; b *= 2) {
    if (rest & b) {
      out.push({ bit: b, name: `bit ${b}`, about: 'A feature this Cairn does not know.' });
      rest &= ~b;
    }
  }
  return out;
}

/** Image flags: object-map-invalid (1), fast-diff-invalid (2). */
export function decodeFlags(bits: number): string[] {
  const out: string[] = [];
  if (bits & 1) out.push('object-map-invalid');
  if (bits & 2) out.push('fast-diff-invalid');
  return out;
}

/** Operation features: why old clients may not open the image. */
export function decodeOpFeatures(bits: number): string[] {
  const m: [number, string][] = [
    [1, 'clone-parent'],
    [2, 'clone-child'],
    [4, 'group'],
    [8, 'snap-trash'],
    [16, 'mirror'],
    [32, 'non-primary'],
  ];
  return m.filter(([b]) => bits & b).map(([, x]) => x);
}

/** Features a user may choose at create time, with the default set. */
export const CREATE_FEATURES = ['layering', 'exclusive-lock', 'object-map', 'fast-diff', 'deep-flatten', 'journaling'];
export const DEFAULT_FEATURES = ['layering', 'exclusive-lock', 'object-map', 'fast-diff', 'deep-flatten'];

const NEEDS: Record<string, string[]> = {
  'object-map': ['exclusive-lock'],
  'fast-diff': ['object-map'],
  journaling: ['exclusive-lock'],
};

/** Feature dependencies that a selection breaks, in words. */
export function featureProblems(sel: string[]): string[] {
  const out: string[] = [];
  for (const f of sel) for (const need of NEEDS[f] ?? []) if (!sel.includes(need)) out.push(`${f} needs ${need}.`);
  return out;
}

/** Turning a feature on also turns on what it needs; off turns off what needs it. */
export function toggleFeature(sel: string[], f: string, on: boolean): string[] {
  const set = new Set(sel);
  const add = (x: string) => {
    set.add(x);
    (NEEDS[x] ?? []).forEach(add);
  };
  const remove = (x: string) => {
    set.delete(x);
    Object.entries(NEEDS)
      .filter(([, needs]) => needs.includes(x))
      .forEach(([dep]) => set.has(dep) && remove(dep));
  };
  if (on) add(f);
  else remove(f);
  return CREATE_FEATURES.filter(x => set.has(x));
}

/* --------------------------------------------------------------- names */

/** pool/image or pool/namespace/image, as the rbd tool takes it. */
export function imageSpec(pool: string, ns: string | undefined, image: string): string {
  return ns ? `${pool}/${ns}/${image}` : `${pool}/${image}`;
}

export function snapSpec(pool: string, ns: string | undefined, image: string, snap: string): string {
  return `${imageSpec(pool, ns, image)}@${snap}`;
}

const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Problems with a new image or snapshot name. */
export function nameProblem(name: string, taken: string[], what = 'image'): string | null {
  const v = name.trim();
  if (!v) return `Give the ${what} a name.`;
  if (!IMAGE_NAME.test(v)) return 'Use letters, digits, dots, dashes and underscores (up to 128), starting with a letter or digit.';
  if (taken.includes(v)) return `An ${what} named ${v} already exists here.`;
  return null;
}

/** Image names ceph-csi gives the volumes and snapshots it provisions. */
export function isCsiName(name: string): boolean {
  return /^csi-(vol|snap)-[0-9a-f-]{36}$/.test(name);
}

/* ------------------------------------------------- Kubernetes binding */

export interface VmRef {
  namespace: string;
  name: string;
  /** Running (a virt-launcher pod) or only declared in a VirtualMachine. */
  running: boolean;
}

export interface ImageBinding {
  pv?: Obj;
  pvc?: Obj;
  /** Pods that mount the PVC and still run. */
  pods: Obj[];
  vms: VmRef[];
  /** Created by Ceph-CSI (a PV points at it, or a csi-vol-/csi-snap- name). */
  csi: boolean;
}

const RBD_CSI = /\.rbd\.csi\.ceph\.com$/;

/** The key a PV names: pool, RADOS namespace and image. */
export function pvImageKey(pv: Obj): string | null {
  const c = pv.spec?.csi;
  if (!c || !RBD_CSI.test(String(c.driver ?? ''))) return null;
  const a = c.volumeAttributes ?? {};
  if (!a.imageName || !a.pool) return null;
  return `${a.pool}/${a.radosNamespace ?? ''}/${a.imageName}`;
}

const podDone = (p: Obj) => p.status?.phase === 'Succeeded' || p.status?.phase === 'Failed';

/** Pods by "namespace/claim" they mount (running ones only). */
export function podsByClaim(pods: Obj[]): Map<string, Obj[]> {
  const out = new Map<string, Obj[]>();
  for (const p of pods) {
    if (podDone(p)) continue;
    for (const v of p.spec?.volumes ?? []) {
      const c = v?.persistentVolumeClaim?.claimName;
      if (!c) continue;
      const k = `${p.metadata.namespace}/${c}`;
      const l = out.get(k) ?? [];
      if (!l.includes(p)) l.push(p);
      out.set(k, l);
    }
  }
  return out;
}

/** The VM a virt-launcher pod runs, if it is one. */
export function vmOfPod(p: Obj): string | null {
  const l = p.metadata.labels ?? {};
  return l['vm.kubevirt.io/name'] || l['kubevirt.io/domain'] || null;
}

/** VMs (VirtualMachine objects) by "namespace/claim" of the volumes they declare. */
export function vmsByClaim(vms: Obj[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const vm of vms) {
    for (const v of vm.spec?.template?.spec?.volumes ?? []) {
      const c = v?.persistentVolumeClaim?.claimName ?? v?.dataVolume?.name;
      if (!c) continue;
      const k = `${vm.metadata.namespace}/${c}`;
      out.set(k, [...(out.get(k) ?? []), vm.metadata.name]);
    }
  }
  return out;
}

/** Bindings of every image of one pool/namespace, keyed by image name. */
export function bindingsFor(pool: string, ns: string, data: { pvs: Obj[]; pvcs: Obj[]; pods: Obj[]; vms?: Obj[] }): Map<string, ImageBinding> {
  const pvcBy = new Map(data.pvcs.map(c => [`${c.metadata.namespace}/${c.metadata.name}`, c]));
  const pods = podsByClaim(data.pods);
  const vms = vmsByClaim(data.vms ?? []);
  const out = new Map<string, ImageBinding>();
  for (const pv of data.pvs) {
    const key = pvImageKey(pv);
    if (!key) continue;
    const [p, n0, ...rest] = key.split('/');
    if (p !== pool || n0 !== (ns ?? '')) continue;
    const image = rest.join('/');
    const ref = pv.spec?.claimRef;
    const claimKey = ref ? `${ref.namespace}/${ref.name}` : '';
    const pvc = claimKey ? pvcBy.get(claimKey) : undefined;
    const using = claimKey ? pods.get(claimKey) ?? [] : [];
    const vmRefs: VmRef[] = [];
    for (const pod of using) {
      const vm = vmOfPod(pod);
      if (vm && !vmRefs.some(v => v.name === vm && v.namespace === pod.metadata.namespace))
        vmRefs.push({ namespace: pod.metadata.namespace!, name: vm, running: true });
    }
    for (const vm of claimKey ? vms.get(claimKey) ?? [] : []) {
      if (!vmRefs.some(v => v.name === vm && v.namespace === ref.namespace)) vmRefs.push({ namespace: ref.namespace, name: vm, running: false });
    }
    out.set(image, { pv, pvc, pods: using, vms: vmRefs, csi: true });
  }
  return out;
}

export function bindingOf(map: Map<string, ImageBinding>, image: string): ImageBinding {
  return map.get(image) ?? { pods: [], vms: [], csi: isCsiName(image) };
}

/* ------------------------------------------------------------- safety */

export interface Verdict {
  ok: boolean;
  /** Why not (or, when ok, a caution to show). */
  reason?: string;
}

const yes = (reason?: string): Verdict => ({ ok: true, reason });
const no = (reason: string): Verdict => ({ ok: false, reason });

export function inUse(img: RbdImage, b: ImageBinding): boolean {
  return (img.watchers?.length ?? 0) > 0 || b.pods.length > 0;
}

function who(img: RbdImage, b: ImageBinding): string {
  if (b.vms.some(v => v.running)) return `the VM ${b.vms.filter(v => v.running).map(v => `${v.namespace}/${v.name}`).join(', ')}`;
  if (b.pods.length) return `pod ${b.pods.map(p => `${p.metadata.namespace}/${p.metadata.name}`).join(', ')}`;
  const w = img.watchers?.length ?? 0;
  return `${w} client${w === 1 ? '' : 's'} (watchers)`;
}

const dependents = (k: RbdRef[]) =>
  `${k.length === 1 ? 'The clone' : `${k.length} clones`} ${k.map(c => c.image).join(', ')} ${k.length === 1 ? 'depends' : 'depend'} on it: flatten or remove ${
    k.length === 1 ? 'it' : 'them'
  } first.`;

const CSI_SNAP =
  'The CSI driver owns this image. Raw RBD snapshots get in its way: Kubernetes cannot delete the PersistentVolume while they exist. Take a VolumeSnapshot of the claim instead.';

export interface ImageRules {
  snapshot: Verdict;
  volumeSnapshot: Verdict;
  resize: Verdict;
  trash: Verdict;
  flatten: Verdict;
  rollback: (s: RbdSnap) => Verdict;
  removeSnap: (s: RbdSnap) => Verdict;
  protect: (s: RbdSnap) => Verdict;
  unprotect: (s: RbdSnap) => Verdict;
  clone: (s: RbdSnap) => Verdict;
}

/**
 * Clones that may depend on one snapshot of the image. Ceph lists an
 * image's children across all its snapshots; `others` (images whose
 * parent is known) say which snapshot each came from. Children not
 * found there are counted for every snapshot, to stay on the safe side.
 */
export function childrenOf(img: RbdImage, snap: string, where: { pool: string; ns: string }, others: RbdImage[] = []): RbdRef[] {
  const known = others.filter(x => x.parent && x.parent.image === img.name && x.parent.pool === where.pool && (x.parent.ns ?? '') === (where.ns ?? ''));
  const forSnap: RbdRef[] = known.filter(x => x.parent!.snap === snap).map(x => ({ pool: where.pool, ns: where.ns, image: x.name, snap }));
  const unknown = img.children.filter(c => !known.some(k => k.name === c.image && c.pool === where.pool && (c.ns ?? '') === (where.ns ?? '')));
  return [...forSnap, ...unknown];
}

/**
 * What may be done to an image. `cloneNeedsProtect`: clone v1 (min compat
 * client below mimic) clones only protected snapshots. `others`: images
 * of the pool (at least the image's children), to tell which snapshot
 * each clone depends on.
 */
export function imageRules(
  img: RbdImage,
  b: ImageBinding,
  opts: { cloneNeedsProtect: boolean; pool: string; ns: string; others?: RbdImage[] }
): ImageRules {
  const busy = inUse(img, b);
  const csi = b.csi || isCsiName(img.name);
  const layering = (img.features & 1) !== 0;
  const userSnap = (sn: RbdSnap) => sn.nsType === null || sn.nsType === 0;
  const kids = (sn: RbdSnap) => childrenOf(img, sn.name, { pool: opts.pool, ns: opts.ns }, opts.others);
  const csiSnapOps = no('The CSI driver owns this image and its snapshots: manage them with VolumeSnapshots in Kubernetes.');
  return {
    snapshot: csi ? no(CSI_SNAP) : yes(busy ? `The image is in use by ${who(img, b)}: the snapshot is crash-consistent, like pulling the power.` : undefined),
    volumeSnapshot: b.pvc ? yes() : no('No PersistentVolumeClaim is bound to this image.'),
    resize: csi
      ? no('The CSI driver owns this image: grow it by raising the claim’s requested size, so Kubernetes and the filesystem follow.')
      : yes(busy ? 'The client sees the new size only after it rescans the device; grow the filesystem on it yourself.' : undefined),
    trash: csi
      ? no(b.pvc ? `Delete the claim ${b.pvc.metadata.namespace}/${b.pvc.metadata.name}; the CSI driver removes the image.` : 'The CSI driver owns this image: delete its PersistentVolume instead.')
      : busy
      ? no(`The image is in use by ${who(img, b)}: stop it first.`)
      : yes(),
    flatten: !img.parent ? no('The image is not a clone.') : csi ? no('The CSI driver flattens its own clones.') : yes('Copies every block the clone still reads from its parent: uses that much more space.'),
    rollback: sn => {
      if (!userSnap(sn)) return no('Ceph manages this snapshot (group, trash or mirror).');
      if (csi) return csiSnapOps;
      if (busy) return no(`The image is in use by ${who(img, b)}: rolling back under a running client corrupts its data. Stop it first.`);
      return yes(`Everything written to ${img.name} since ${sn.name} was taken is lost.`);
    },
    removeSnap: sn => {
      if (!userSnap(sn)) return no('Ceph manages this snapshot (group, trash or mirror).');
      if (csi) return csiSnapOps;
      if (sn.protected) return no('The snapshot is protected: unprotect it first.');
      const k = kids(sn);
      if (k.length) return no(dependents(k));
      return yes();
    },
    protect: sn => (!userSnap(sn) ? no('Ceph manages this snapshot.') : csi ? csiSnapOps : sn.protected ? no('Already protected.') : yes()),
    unprotect: sn => {
      if (!userSnap(sn)) return no('Ceph manages this snapshot.');
      if (csi) return csiSnapOps;
      if (!sn.protected) return no('Not protected.');
      const k = kids(sn);
      if (k.length) return no(dependents(k));
      return yes();
    },
    clone: sn => {
      if (!userSnap(sn)) return no('Ceph manages this snapshot.');
      if (csi) return csiSnapOps;
      if (!layering) return no('The image lacks the layering feature, which clones need.');
      if (opts.cloneNeedsProtect && !sn.protected) return no('Protect the snapshot first: this cluster makes version 1 clones, which need a protected parent.');
      return yes();
    },
  };
}

const RELEASES = ['jewel', 'kraken', 'luminous', 'mimic', 'nautilus', 'octopus', 'pacific', 'quincy', 'reef', 'squid', 'tentacle'];

/**
 * Clone v2 (no protection needed) requires clients of mimic or newer:
 * with rbd_default_clone_format "auto", Ceph makes v2 clones only when
 * require_min_compat_client is mimic or later.
 */
export function cloneNeedsProtect(minCompatClient: string, cloneFormat = 'auto'): boolean {
  if (cloneFormat.trim() === '1') return true;
  if (cloneFormat.trim() === '2') return false;
  const i = RELEASES.indexOf((minCompatClient || '').trim().toLowerCase());
  return i < 0 || i < RELEASES.indexOf('mimic');
}

/** A snapshot name for "now": snap-2026-11-23-0415. */
export function snapNameNow(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `snap-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** The VolumeSnapshot for a claim. */
export function volumeSnapshotFor(pvc: Obj, className: string, name: string): Obj {
  return {
    apiVersion: 'snapshot.storage.k8s.io/v1',
    kind: 'VolumeSnapshot',
    metadata: { name, namespace: pvc.metadata.namespace },
    spec: { volumeSnapshotClassName: className, source: { persistentVolumeClaimName: pvc.metadata.name } },
  };
}

/** Is the trash entry still protected from removal? */
export function trashDeferred(t: RbdTrashEntry, now = Date.now()): boolean {
  return !!t.deferredUntil && t.deferredUntil > now;
}
