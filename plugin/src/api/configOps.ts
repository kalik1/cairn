/*
 * Ceph configuration changes ("config set", "config rm") recorded as
 * operations, and the access checks the Cairn settings tab shows: what the
 * current user may do, and which Cairn role (distribution/rbac.yaml)
 * grants it.
 */

import { configCommandText } from '../model/config';
import { Obj } from '../model/types';
import { runOp } from './activity';
import { mon } from './bridge';
import { invalidateCephQueries, runCeph } from './ceph';
import { kget, objPath } from './client';
import { Attrs } from './permissions';

export async function configSet(ns: string, who: string, name: string, value: string): Promise<string> {
  const msg = await runOp({
    title: `Set ${name} for ${who}`,
    target: `config ${who} ${name}`,
    detail: configCommandText('set', who, name, value),
    run: () => runCeph(ns, mon('config set', { who, name, value })),
  });
  invalidateCephQueries('config.');
  return msg;
}

export async function configRemove(ns: string, who: string, name: string): Promise<string> {
  const msg = await runOp({
    title: `Remove ${name} for ${who}`,
    target: `config ${who} ${name}`,
    detail: configCommandText('rm', who, name),
    run: () => runCeph(ns, mon('config rm', { who, name })),
  });
  invalidateCephQueries('config.');
  return msg;
}

/**
 * The CephCluster as it is now. Rook updates its status every few seconds,
 * so a preview built from a listed copy is refused (409) when applied or
 * validated; build CephCluster previews from this one.
 */
export async function latestCluster(cluster: Obj): Promise<Obj> {
  try {
    return await kget<Obj>(objPath(cluster.apiVersion ?? 'ceph.rook.io/v1', 'cephclusters', cluster.metadata.name, cluster.metadata.namespace));
  } catch {
    return cluster;
  }
}

export type CairnRole = 'cairn-viewer' | 'cairn-editor' | 'cairn-admin';

export interface AccessCheck {
  id: string;
  what: string;
  attrs: Attrs;
  role: CairnRole;
}

/** What the access summary checks. `ns` is the CephCluster namespace, `execNs` where Ceph commands run. */
export function accessChecks(ns: string, execNs: string): AccessCheck[] {
  return [
    { id: 'rook', what: 'See Rook resources and their status', attrs: { verb: 'list', group: 'ceph.rook.io', resource: 'cephclusters' }, role: 'cairn-viewer' },
    { id: 'sc', what: 'See StorageClasses', attrs: { verb: 'list', group: 'storage.k8s.io', resource: 'storageclasses' }, role: 'cairn-viewer' },
    { id: 'pv', what: 'See volumes', attrs: { verb: 'list', group: '', resource: 'persistentvolumes' }, role: 'cairn-viewer' },
    { id: 'pods', what: 'See pods (who uses a volume)', attrs: { verb: 'list', group: '', resource: 'pods' }, role: 'cairn-viewer' },
    {
      id: 'exec',
      what: "Read Ceph's live state and run Ceph operations",
      attrs: { verb: 'create', group: '', resource: 'pods', subresource: 'exec', namespace: execNs },
      role: 'cairn-admin',
    },
    { id: 'pool-c', what: 'Create pools', attrs: { verb: 'create', group: 'ceph.rook.io', resource: 'cephblockpools', namespace: ns }, role: 'cairn-editor' },
    { id: 'pool-u', what: 'Change pools', attrs: { verb: 'update', group: 'ceph.rook.io', resource: 'cephblockpools', namespace: ns }, role: 'cairn-editor' },
    { id: 'pool-d', what: 'Delete pools', attrs: { verb: 'delete', group: 'ceph.rook.io', resource: 'cephblockpools', namespace: ns }, role: 'cairn-editor' },
    { id: 'cluster-u', what: 'Change the CephCluster', attrs: { verb: 'update', group: 'ceph.rook.io', resource: 'cephclusters', namespace: ns }, role: 'cairn-editor' },
    { id: 'sc-c', what: 'Create StorageClasses', attrs: { verb: 'create', group: 'storage.k8s.io', resource: 'storageclasses' }, role: 'cairn-editor' },
    { id: 'sc-d', what: 'Delete StorageClasses', attrs: { verb: 'delete', group: 'storage.k8s.io', resource: 'storageclasses' }, role: 'cairn-editor' },
    {
      id: 'vsc-c',
      what: 'Create snapshot classes',
      attrs: { verb: 'create', group: 'snapshot.storage.k8s.io', resource: 'volumesnapshotclasses' },
      role: 'cairn-editor',
    },
    { id: 'obc-c', what: 'Create bucket claims', attrs: { verb: 'create', group: 'objectbucket.io', resource: 'objectbucketclaims' }, role: 'cairn-editor' },
    { id: 'secrets', what: 'Show object store user keys', attrs: { verb: 'get', group: '', resource: 'secrets', namespace: ns }, role: 'cairn-admin' },
  ];
}

/** "create pods/exec in rook-ceph" for an access check. */
export function attrsText(a: Attrs): string {
  const res = `${a.resource}${a.subresource ? `/${a.subresource}` : ''}${a.group ? `.${a.group}` : ''}`;
  return `${a.verb} ${res}${a.namespace ? ` in ${a.namespace}` : ''}`;
}

export const ROLES: { role: CairnRole; summary: string; detail: string }[] = [
  {
    role: 'cairn-viewer',
    summary: 'Sees what Kubernetes knows',
    detail:
      'Rook resources and their status (health and capacity as Rook reports them), StorageClasses, snapshot classes, volumes, CSI drivers, Rook pods and events. No live Ceph state, no operations.',
  },
  {
    role: 'cairn-editor',
    summary: 'Changes Rook resources and StorageClasses',
    detail:
      'Everything a viewer sees, and creates, edits and deletes Rook resources (pools, file systems, object stores, users, clients…), StorageClasses, snapshot classes and VolumeSnapshots. Rook applies them to Ceph.',
  },
  {
    role: 'cairn-admin',
    summary: 'Runs Ceph commands: a Ceph administrator',
    detail:
      "A Role in the Rook namespace: exec in the toolbox or operator pod, which holds the Ceph admin keyring. Cairn then reads Ceph's live state and runs operations (OSD out/in, flags, mutes, config, RBD snapshots…). Give it to storage administrators only; bind it together with cairn-editor.",
  },
];
