/*
 * Pool operations, all through the CephBlockPool resource: Cairn writes
 * the CR (preview, dry run, apply) and Rook changes Ceph. Deleting first
 * asks Ceph what still lives in the pool (images, trash, namespaces).
 */

import { bytes } from '../model/format';
import { buildBlockPool, deleteBlockers, DeleteInput, editImpact, Line, PoolForm } from '../model/pools';
import { Obj, Pool } from '../model/types';
import { previewChange } from '../ui/ChangeDialog';
import { cephBatch } from './bridge';
import { invalidateCephQueries } from './ceph';
import { rbdKey } from './rbdOps';

const text = (l: Line[]) => l.map(x => x.text);

export function previewCreatePool(f: PoolForm, ns: string, lines: Line[], onDone?: () => void): Promise<boolean> {
  const after = buildBlockPool(f, ns);
  return previewChange({
    title: `Create pool ${after.metadata.name}`,
    op: 'create',
    after,
    consequences: [
      ...text(lines),
      f.type === 'erasure'
        ? 'Rook enables overwrites on the pool so RBD can use it as a data pool; keep image metadata in a replicated pool.'
        : 'Rook tags it for RBD (rbd pool init) once it is ready.',
    ],
    action: 'Create pool',
    target: `pool ${after.metadata.name}`,
    onDone,
  });
}

export function previewEditPool(cr: Obj, before: PoolForm, f: PoolForm, pool?: Pool, onDone?: () => void): Promise<boolean> {
  const after = buildBlockPool(f, cr.metadata.namespace ?? '', cr);
  const imp = editImpact(before, f, pool?.usage ? { stored: pool.usage.stored, objects: pool.usage.objects } : undefined);
  return previewChange({
    title: `Change pool ${cr.metadata.name}`,
    op: 'update',
    before: cr,
    after,
    consequences: imp.lines.length ? text(imp.lines) : ['Nothing that moves data or blocks writes.'],
    warning: imp.danger
      ? 'This change puts data or writes at risk: read the consequences.'
      : imp.movesData
      ? 'Data moves after this change. Client I/O continues, a little slower, until Ceph is done.'
      : undefined,
    danger: imp.danger,
    typeToConfirm: imp.danger ? cr.metadata.name : undefined,
    action: 'Apply change',
    target: `pool ${cr.metadata.name}`,
    onDone,
  });
}

/** Asks Ceph what still lives in the pool: images (all RADOS namespaces) and trash. */
export async function poolContents(cluster: string, pool: string): Promise<{ images: string[] | null; trash: number; error?: string }> {
  const rbd = (...args: string[]) => ({ t: 'cli' as const, bin: 'rbd' as const, args: [...args, '--format', 'json'] });
  const fail = (r?: { err?: string }) => (r?.err || 'no answer').trim().split('\n').pop();
  try {
    const [ls, trash, nsl] = await cephBatch(cluster, [rbd('ls', pool), rbd('trash', 'ls', pool), rbd('namespace', 'ls', pool)]);
    if (!ls || ls.r !== 0) return { images: null, trash: 0, error: fail(ls) };
    const images: string[] = Array.isArray(ls.out) ? ls.out.map(String) : [];
    let inTrash = trash?.r === 0 && Array.isArray(trash.out) ? trash.out.length : 0;
    const nss: string[] = nsl?.r === 0 && Array.isArray(nsl.out) ? nsl.out.map((n: any) => String(n?.name ?? n)) : [];
    if (nss.length) {
      const more = await cephBatch(cluster, nss.flatMap(n => [rbd('ls', `${pool}/${n}`), rbd('trash', 'ls', `${pool}/${n}`)]));
      for (let i = 0; i < nss.length; i++) {
        const l = more[i * 2];
        if (!l || l.r !== 0) return { images: null, trash: inTrash, error: fail(l) };
        if (Array.isArray(l.out)) images.push(...l.out.map((x: any) => `${nss[i]}/${x}`));
        const tr = more[i * 2 + 1];
        if (tr?.r === 0 && Array.isArray(tr.out)) inTrash += tr.out.length;
      }
    }
    return { images, trash: inTrash };
  } catch (e) {
    return { images: null, trash: 0, error: (e as Error).message };
  }
}

/**
 * Delete a CephBlockPool: checks what is in the way, says exactly what
 * when something is, else previews the delete with typed-name confirmation.
 */
export async function deletePoolFlow(
  cluster: string,
  cr: Obj,
  input: Omit<DeleteInput, 'images' | 'trash' | 'listError'>,
  opts: { pool?: Pool; onBlocked: (blockers: string[]) => void; onDone?: () => void }
) {
  const { pool, onDone } = opts;
  const c = await poolContents(cluster, input.pool);
  const blockers = deleteBlockers({ ...input, images: c.images, trash: c.trash, listError: c.error });
  if (blockers.length) {
    opts.onBlocked(blockers);
    return false;
  }
  const stored = pool?.usage?.stored ?? 0;
  return previewChange({
    title: `Delete pool ${input.pool}`,
    op: 'delete',
    before: cr,
    warning: `Rook deletes the Ceph pool ${input.pool} and every object in it. This cannot be undone.`,
    consequences: [
      `${bytes(stored)} of data in ${pool?.usage?.objects ?? 0} objects is removed.`,
      'No StorageClass, PersistentVolume or RBD image uses it (checked just now).',
      `Rook removes its CRUSH rule ${pool?.crushRule ?? input.pool} too.`,
    ],
    typeToConfirm: input.pool,
    danger: true,
    action: 'Delete pool',
    target: `pool ${input.pool}`,
    onDone: () => {
      invalidateCephQueries(rbdKey(input.pool));
      onDone?.();
    },
  });
}
