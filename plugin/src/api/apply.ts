/*
 * Writes to Kubernetes objects (Rook CRs, StorageClasses, snapshot
 * classes…) with an optional server-side dry run first. Updates are JSON
 * Patches with a "test" for every edited field (src/model/patch.ts): a
 * concurrent change to those fields is refused, not overwritten, while
 * unrelated writes (Rook rewrites a CephCluster's status every minute) do
 * not get in the way. Without the "before" object an update is a PUT with
 * the resourceVersion.
 */

import { cleanForDiff } from '../model/diff';
import { jsonPatch } from '../model/patch';
import { Obj } from '../model/types';
import { DRY_RUN, kdelete, kjsonpatch, kpost, kput, objPath } from './client';

export type ChangeOp = 'create' | 'update' | 'delete';

export function pluralOf(o: Obj): string {
  const k = (o.kind ?? '').toLowerCase();
  const special: Record<string, string> = {
    cephnfs: 'cephnfses',
    storageclass: 'storageclasses',
    volumesnapshotclass: 'volumesnapshotclasses',
    cephfilesystemsubvolumegroup: 'cephfilesystemsubvolumegroups',
    cephblockpoolradosnamespace: 'cephblockpoolradosnamespaces',
    objectbucketclaim: 'objectbucketclaims',
  };
  return special[k] ?? `${k}s`;
}

/** Path of the object (or of its collection for create). */
export function pathOf(o: Obj, collection = false): string {
  return objPath(o.apiVersion ?? 'v1', pluralOf(o), collection ? undefined : o.metadata.name, o.metadata.namespace);
}

export async function applyChange(op: ChangeOp, obj: Obj, dryRun = false, before?: Obj | null): Promise<Obj | unknown> {
  const q = dryRun ? { ...DRY_RUN } : undefined;
  if (op === 'create') return kpost(pathOf(obj, true), obj, q);
  if (op === 'update') {
    if (!before) return kput(pathOf(obj), obj, q);
    const ops = jsonPatch(cleanForDiff(before), cleanForDiff(obj));
    if (!ops.length) return obj;
    try {
      return await kjsonpatch(pathOf(obj), ops, q);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      // A failed "test" is a bare 422 (schema errors name the field instead).
      if (err.status === 422 && /rejected our request due to an error in our request/i.test(err.message ?? '')) {
        const x = new Error('Changed meanwhile - someone changed these fields since this page read them: reload and try again') as Error & { status?: number };
        x.status = 409;
        throw x;
      }
      throw e;
    }
  }
  return kdelete(pathOf(obj), undefined, q);
}
