/*
 * What the RBD views read: image lists (bridge rbd_images, watchers on),
 * usage (rbd du), one image with its children, and the Kubernetes side
 * (PVs, PVCs, pods, KubeVirt VMs) that tells who uses an image.
 */

import { Router } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { CephQuery } from '../../api/bridge';
import { out, outError, useCeph, useCephQuery } from '../../api/ceph';
import { useAllPods, useKube } from '../../api/kube';
import { rbdKey } from '../../api/rbdOps';
import { VirtualMachine } from '../../api/resources';
import { bindingsFor, cloneNeedsProtect, ImageBinding, imageSpec, parseRbdDu, parseRbdImages, RbdImage, RbdTrashEntry } from '../../model/rbd';
import { Obj } from '../../model/types';

const firstLine = (s?: string | null) => (s ? s.trim().split('\n').filter(Boolean).pop() ?? s : null);

export function duQuery(pool: string, ns: string, image?: string): CephQuery {
  return { t: 'cli', bin: 'rbd', args: image ? ['du', '--format', 'json', imageSpec(pool, ns, image)] : ['du', '--format', 'json', '--pool', pool, ...(ns ? ['--namespace', ns] : [])] };
}

export interface RbdList {
  images: RbdImage[];
  trash: RbdTrashEntry[];
  namespaces: string[];
  du: ReturnType<typeof parseRbdDu> | null;
  error: string | null;
  duError: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Images, trash and RADOS namespaces of a pool (namespace "" = default), and their usage. */
export function useRbdList(pool: string | undefined, ns: string): RbdList {
  const key = pool ? `${rbdKey(pool)}${ns}` : 'rbd:-';
  const q = useCephQuery(`${key}:list`, pool ? [{ t: 'rbd_images', pool, ...(ns ? { ns } : {}), trash: true, namespaces: true, watchers: true }] : null, {
    intervalMs: 30000,
    staleMs: 10000,
  });
  const d = useCephQuery(`${key}:du`, pool ? [duQuery(pool, ns)] : null, { intervalMs: 60000, staleMs: 30000 });
  const parsed = React.useMemo(() => parseRbdImages(out(q.data)), [q.data]);
  const du = React.useMemo(() => (out(d.data) ? parseRbdDu(out(d.data)) : null), [d.data]);
  return {
    images: parsed.images,
    trash: parsed.trash,
    namespaces: parsed.namespaces ?? [],
    du,
    error: firstLine(outError(q.data) ?? q.error),
    duError: firstLine(outError(d.data) ?? d.error),
    loading: q.loading && !q.data,
    refresh: () => {
      q.refresh();
      d.refresh();
    },
  };
}

export interface RbdOne {
  image: RbdImage | null;
  /** Images that are its children in the same pool (to tell which snapshot each depends on). */
  children: RbdImage[];
  du: ReturnType<typeof parseRbdDu> | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

export function useRbdImage(pool: string, ns: string, image: string): RbdOne {
  const key = `${rbdKey(pool)}${ns}:img:${image}`;
  const q = useCephQuery(key, [{ t: 'rbd_images', pool, ...(ns ? { ns } : {}), images: [image], watchers: true }, duQuery(pool, ns, image)], {
    intervalMs: 15000,
    staleMs: 5000,
  });
  const img = React.useMemo(() => parseRbdImages(out(q.data, 0)).images[0] ?? null, [q.data]);
  const du = React.useMemo(() => (out(q.data, 1) ? parseRbdDu(out(q.data, 1)) : null), [q.data]);
  const kids = (img?.children ?? []).filter(c => c.pool === pool && (c.ns ?? '') === ns && !c.trash).map(c => c.image);
  const k = useCephQuery(`${key}:kids`, kids.length ? [{ t: 'rbd_images', pool, ...(ns ? { ns } : {}), images: kids }] : null, { staleMs: 5000 });
  const children = React.useMemo(() => (kids.length ? parseRbdImages(out(k.data)).images.filter(i => !i.error) : []), [k.data, kids.length]);
  return {
    image: img && !img.error ? img : null,
    children,
    du,
    error: firstLine(img?.error ?? outError(q.data, 0) ?? q.error),
    loading: q.loading && !q.data,
    refresh: () => {
      q.refresh();
      k.refresh();
    },
  };
}

/** KubeVirt VirtualMachines (empty when KubeVirt is not installed). */
export function useVms(): Obj[] {
  const res = (VirtualMachine as any).useList({ refetchInterval: 60000 });
  const items: any[] | null = res?.items ?? res?.[0] ?? null;
  const sig = items ? items.map(i => `${i?.metadata?.uid}:${i?.metadata?.resourceVersion}`).join(',') : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => (items ?? []).map(i => (i?.jsonData ?? i) as Obj), [sig]);
}

/** Who uses each image of a pool/namespace, from PVs, PVCs, pods and VMs. */
export function useBindings(pool: string | undefined, ns: string): Map<string, ImageBinding> {
  const k = useKube();
  const pods = useAllPods(!!pool);
  const vms = useVms();
  return React.useMemo(
    () => (pool ? bindingsFor(pool, ns, { pvs: k.pvs.items, pvcs: k.pvcs.items, pods: pods.items, vms }) : new Map()),
    [pool, ns, k.pvs.items, k.pvcs.items, pods.items, vms]
  );
}

/** Clone v1 or v2 on this cluster. */
export function useCloneNeedsProtect(): boolean {
  const c = useCeph();
  return cloneNeedsProtect(c.core.osdMap?.requireMinCompatClient ?? '');
}

/** Hangar's page of a VM, when the Hangar plugin is installed. */
export function hangarVmHref(namespace: string, name: string): string | null {
  try {
    const u = Router.createRouteURL('hangar', { view: 'vm', a: namespace, b: name });
    return u && u !== '/' ? u : null;
  } catch {
    return null;
  }
}

/** Pools that hold RBD images (application rbd). */
export function useRbdPools() {
  const c = useCeph();
  return React.useMemo(() => c.core.pools.filter(p => p.applications.includes('rbd')), [c.core.pools]);
}
