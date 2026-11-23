/*
 * Object storage commands and changes. Reads run radosgw-admin through
 * the bridge with the store's realm, zone group and zone (the bridge blanks
 * secret keys; the model drops access keys). Changes are Rook resources,
 * StorageClasses and ObjectBucketClaims through the change preview.
 *
 * S3 credentials are read only on an explicit "Show keys": from the Secret
 * Rook (or the bucket provisioner) wrote, after an access review, straight
 * into the component that shows them. They are never logged, recorded in
 * the activity or kept anywhere else.
 */

import { classStore, decodeCredentials, rgwArgs } from '../model/object';
import { Obj } from '../model/types';
import { previewChange } from '../ui/ChangeDialog';
import { CephQuery } from './bridge';
import { invalidateCephQueries } from './ceph';
import { errorText, kget } from './client';
import { can } from './permissions';

export const OBJECT_KEY = 'object';

const rgw = (store: Obj, args: string[]): CephQuery => ({ t: 'cli', bin: 'radosgw-admin', args: [...args, ...rgwArgs(store)], timeout: 40 });

/** Users and bucket stats of a store. */
export const storeQueries = (store: Obj): CephQuery[] => [rgw(store, ['user', 'list']), rgw(store, ['bucket', 'stats'])];

/** user info of each uid. */
export const userInfoQueries = (store: Obj, uids: string[]): CephQuery[] => uids.map(uid => rgw(store, ['user', 'info', '--uid', uid]));

export const USER_INFO_LIMIT = 100;

const after = (refresh?: () => void, onDone?: () => void) => () => {
  invalidateCephQueries(OBJECT_KEY);
  refresh?.();
  onDone?.();
};

export function createStore(cr: Obj, o: { refresh?: () => void; onDone?: () => void } = {}): Promise<boolean> {
  const gw = cr.spec?.gateway ?? {};
  const n = cr.metadata.name;
  return previewChange({
    title: `Create object store ${n}`,
    op: 'create',
    after: cr,
    action: 'Create object store',
    target: `objectstore ${n}`,
    consequences: [
      `Rook creates a realm, zone group and zone named ${n}, and the pools ${n}.rgw.* (metadata, index, log…) with ${n}.rgw.buckets.data for objects.`,
      `It starts ${gw.instances ?? 1} S3 gateway pod${(gw.instances ?? 1) === 1 ? '' : 's'} on port ${gw.port ?? 80}${
        gw.resources?.requests?.memory ? `, ${(gw.instances ?? 1) === 1 ? 'asking' : 'each asking'} for ${gw.resources.requests.memory} of memory` : ''
      }, behind the Service rook-ceph-rgw-${n}.`,
      cr.spec?.preservePoolsOnDelete
        ? 'Deleting the resource later keeps the pools and their objects.'
        : 'Deleting the resource later deletes its pools and every object in them.',
    ],
    onDone: after(o.refresh, o.onDone),
  });
}

export function deleteStore(cr: Obj, o: { refresh?: () => void; onDone?: () => void } = {}): Promise<boolean> {
  const n = cr.metadata.name;
  const keep = !!cr.spec?.preservePoolsOnDelete;
  return previewChange({
    title: `Delete object store ${n}`,
    op: 'delete',
    before: cr,
    danger: !keep,
    warning: keep ? undefined : 'The store pools and every object in them will be deleted. This cannot be undone.',
    consequences: [
      `Rook stops the gateways and removes the Service rook-ceph-rgw-${n}.`,
      keep ? 'preservePoolsOnDelete is set: the pools and their objects stay in Ceph.' : `Rook deletes the pools ${n}.rgw.*, and the realm, zone group and zone ${n}.`,
      'The shared pool .rgw.root stays: other stores use it.',
    ],
    typeToConfirm: n,
    action: 'Delete object store',
    target: `objectstore ${n}`,
    onDone: after(o.refresh, o.onDone),
  });
}

export function createUser(cr: Obj, o: { refresh?: () => void; onDone?: () => void } = {}): Promise<boolean> {
  const caps = Object.entries(cr.spec?.capabilities ?? {});
  const q = cr.spec?.quotas ?? {};
  const quotas = [q.maxBuckets !== undefined && `${q.maxBuckets} buckets`, q.maxSize && q.maxSize, q.maxObjects !== undefined && `${q.maxObjects} objects`].filter(Boolean);
  return previewChange({
    title: `Create user ${cr.metadata.name}`,
    op: 'create',
    after: cr,
    action: 'Create user',
    target: `objectuser ${cr.spec?.store}/${cr.metadata.name}`,
    consequences: [
      `Rook creates the S3 user ${cr.metadata.name} in ${cr.spec?.store} and writes its keys to a Secret in ${cr.metadata.namespace}.`,
      caps.length ? `Admin capabilities: ${caps.map(([k, v]) => `${k}=${v}`).join(', ')}.` : 'No admin capabilities: the user works with its own buckets only.',
      quotas.length ? `Quotas: ${quotas.join(', ')}.` : 'No quota.',
    ],
    onDone: after(o.refresh, o.onDone),
  });
}

export function deleteUser(cr: Obj, o: { refresh?: () => void; onDone?: () => void } = {}): Promise<boolean> {
  return previewChange({
    title: `Delete user ${cr.metadata.name}`,
    op: 'delete',
    before: cr,
    danger: true,
    consequences: [
      `Rook removes the S3 user ${cr.metadata.name} and its Secret: applications using its keys stop working.`,
      'Ceph refuses to remove a user that still owns buckets; Rook then keeps the resource until they are gone.',
    ],
    typeToConfirm: cr.metadata.name,
    action: 'Delete user',
    target: `objectuser ${cr.spec?.store}/${cr.metadata.name}`,
    onDone: after(o.refresh, o.onDone),
  });
}

export function createBucketClass(sc: Obj, o: { refresh?: () => void; onDone?: () => void } = {}): Promise<boolean> {
  const s = classStore(sc);
  return previewChange({
    title: `Create bucket StorageClass ${sc.metadata.name}`,
    op: 'create',
    after: sc,
    action: 'Create StorageClass',
    target: `storageclass ${sc.metadata.name}`,
    consequences: [
      `ObjectBucketClaims naming ${sc.metadata.name} get a bucket in ${s?.namespace}/${s?.name}, with a user and a Secret of their own.`,
      sc.reclaimPolicy === 'Retain'
        ? 'Retain: deleting a claim keeps its bucket and objects.'
        : 'Delete: deleting a claim deletes its bucket and every object in it.',
    ],
    onDone: after(o.refresh, o.onDone),
  });
}

export function deleteBucketClass(sc: Obj, claimsUsing: number, o: { refresh?: () => void; onDone?: () => void } = {}): Promise<boolean> {
  return previewChange({
    title: `Delete StorageClass ${sc.metadata.name}`,
    op: 'delete',
    before: sc,
    danger: true,
    consequences: [
      'New bucket claims can no longer name it.',
      claimsUsing ? `${claimsUsing} existing claims keep their buckets, but the provisioner can no longer delete them.` : 'No claim uses it.',
    ],
    typeToConfirm: sc.metadata.name,
    action: 'Delete StorageClass',
    target: `storageclass ${sc.metadata.name}`,
    onDone: after(o.refresh, o.onDone),
  });
}

export function createClaim(obc: Obj, sc: Obj | undefined, o: { refresh?: () => void; onDone?: () => void } = {}): Promise<boolean> {
  return previewChange({
    title: `Create bucket claim ${obc.metadata.name}`,
    op: 'create',
    after: obc,
    action: 'Create bucket claim',
    target: `obc ${obc.metadata.namespace}/${obc.metadata.name}`,
    consequences: [
      `The provisioner creates a bucket${obc.spec?.bucketName ? ` ${obc.spec.bucketName}` : ` named ${obc.metadata.name}-<random>`} and a user that owns it.`,
      `It writes the bucket's address to the ConfigMap ${obc.metadata.name} and its keys to the Secret ${obc.metadata.name}, in ${obc.metadata.namespace}.`,
      sc?.reclaimPolicy === 'Retain' ? 'The StorageClass retains buckets: deleting the claim keeps the bucket.' : 'Deleting the claim later deletes the bucket and its objects.',
    ],
    onDone: after(o.refresh, o.onDone),
  });
}

export function deleteClaim(obc: Obj, sc: Obj | undefined, o: { refresh?: () => void; onDone?: () => void } = {}): Promise<boolean> {
  const retain = sc?.reclaimPolicy === 'Retain';
  return previewChange({
    title: `Delete bucket claim ${obc.metadata.name}`,
    op: 'delete',
    before: obc,
    danger: !retain,
    warning: retain ? undefined : 'The bucket and every object in it will be deleted.',
    consequences: [
      retain ? 'The StorageClass retains buckets: the bucket and its objects stay.' : `The provisioner deletes the bucket${obc.spec?.bucketName ? ` ${obc.spec.bucketName}` : ''}, its objects and its user.`,
      `The Secret and ConfigMap ${obc.metadata.name} go away: pods using them lose their credentials.`,
    ],
    typeToConfirm: obc.metadata.name,
    action: 'Delete bucket claim',
    target: `obc ${obc.metadata.namespace}/${obc.metadata.name}`,
    onDone: after(o.refresh, o.onDone),
  });
}

/**
 * Reads the S3 keys of a Secret, for display only. Checks first that the
 * role may get that Secret, and says so when it may not.
 */
export async function readCredentials(namespace: string, secretName: string): Promise<{ accessKey: string; secretKey: string; endpoint: string }> {
  const ok = await can({ verb: 'get', group: '', resource: 'secrets', namespace, name: secretName });
  if (!ok) throw new Error(`Your role may not read the Secret ${namespace}/${secretName} (get secrets), so Cairn cannot show these keys.`);
  let s: any;
  try {
    s = await kget(`/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(secretName)}`);
  } catch (e) {
    throw new Error(`Could not read the Secret ${namespace}/${secretName}: ${errorText(e)}`);
  }
  const c = decodeCredentials(s);
  if (!c) throw new Error(`The Secret ${namespace}/${secretName} holds no S3 keys.`);
  return c;
}
