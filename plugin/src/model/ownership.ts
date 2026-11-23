/*
 * Who owns a field of a Kubernetes object, from metadata.managedFields.
 *
 * The API server records, for every writer (field manager), the fields it
 * set, as a FieldsV1 tree: "f:spec" → "f:mgr" → "f:count" → {}. A field
 * that a platform operator applies with server-side apply comes back to
 * that operator's value at its next apply, so Cairn shows such a field
 * read-only and says where to change it instead of letting an edit be
 * silently reverted. Today that is k4all's operator (field manager
 * "k4all-operator"); any other manager (kubectl, Rook, Headlamp, Cairn)
 * leaves the field editable.
 */

import { ManagedFieldsEntry, Obj } from './types';

/** The field manager of the k4all operator's server-side applies. */
export const K4ALL_MANAGER = 'k4all-operator';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A field path as FieldsV1 keys. "spec.mgr.count" or ['spec', 'mgr',
 * 'count']; a segment that is already a FieldsV1 key (k:{"name":"rook"},
 * v:"x", i:0) is kept as it is.
 */
function keysOf(path: string | string[]): string[] {
  const parts = Array.isArray(path) ? path : path.split('.');
  return parts.filter(Boolean).map(p => (/^[fkvi]:/.test(p) ? p : `f:${p}`));
}

/**
 * True when a FieldsV1 tree covers the field: the walk reaches it, or
 * stops on an empty set ({}) above it, which means the whole value there
 * is owned as one (an atomic map or list). A parent owned only for its
 * existence (".": {}) does not own its children.
 */
export function fieldsCover(fields: unknown, path: string | string[]): boolean {
  const keys = keysOf(path);
  if (!keys.length || !isObj(fields)) return false;
  let node: unknown = fields;
  for (let i = 0; i < keys.length; i++) {
    if (!isObj(node)) return false;
    if (i > 0 && Object.keys(node).length === 0) return true;
    node = node[keys[i]];
    if (node === undefined) return false;
  }
  return isObj(node);
}

/** The managers that own a field of the object (several when they share it). */
export function fieldManagers(o: Obj | null | undefined, path: string | string[]): string[] {
  const mf = o?.metadata?.managedFields;
  const entries: ManagedFieldsEntry[] = Array.isArray(mf) ? mf : [];
  const out: string[] = [];
  for (const e of entries) {
    if (!e || (e.fieldsType && e.fieldsType !== 'FieldsV1')) continue;
    if (fieldsCover(e.fieldsV1, path) && e.manager && !out.includes(e.manager)) out.push(e.manager);
  }
  return out;
}

export function ownedBy(o: Obj | null | undefined, path: string | string[], manager: string): boolean {
  return fieldManagers(o, path).includes(manager);
}

/** True when the k4all operator owns the field: change it in the k4all addon, not here. */
export function ownedByK4all(o: Obj | null | undefined, path: string | string[]): boolean {
  return ownedBy(o, path, K4ALL_MANAGER);
}

/** Of these fields, the ones the k4all operator owns, as given. */
export function k4allOwnedFields(o: Obj | null | undefined, paths: string[]): string[] {
  return paths.filter(p => ownedByK4all(o, p));
}
