/*
 * Headlamp resource classes for the Rook, Ceph-CSI, ObjectBucket and
 * snapshot objects Cairn lists. Views read their plain JSON; writes go
 * through src/api/client.ts (merge patches, server-side dry runs).
 */

import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

type J = KubeObjectInterface & { spec?: any; status?: any };

function rook(kind: string, apiName: string) {
  return class extends KubeObject<J> {
    static kind = kind;
    static apiName = apiName;
    static apiVersion = 'ceph.rook.io/v1';
    static isNamespaced = true;
  };
}

export const CephCluster = rook('CephCluster', 'cephclusters');
export const CephBlockPool = rook('CephBlockPool', 'cephblockpools');
export const CephBlockPoolRadosNamespace = rook('CephBlockPoolRadosNamespace', 'cephblockpoolradosnamespaces');
export const CephFilesystem = rook('CephFilesystem', 'cephfilesystems');
export const CephFilesystemSubVolumeGroup = rook('CephFilesystemSubVolumeGroup', 'cephfilesystemsubvolumegroups');
export const CephFilesystemMirror = rook('CephFilesystemMirror', 'cephfilesystemmirrors');
export const CephObjectStore = rook('CephObjectStore', 'cephobjectstores');
export const CephObjectStoreUser = rook('CephObjectStoreUser', 'cephobjectstoreusers');
export const CephObjectRealm = rook('CephObjectRealm', 'cephobjectrealms');
export const CephObjectZoneGroup = rook('CephObjectZoneGroup', 'cephobjectzonegroups');
export const CephObjectZone = rook('CephObjectZone', 'cephobjectzones');
export const CephBucketNotification = rook('CephBucketNotification', 'cephbucketnotifications');
export const CephBucketTopic = rook('CephBucketTopic', 'cephbuckettopics');
export const CephClient = rook('CephClient', 'cephclients');
export const CephNFS = rook('CephNFS', 'cephnfses');
export const CephRBDMirror = rook('CephRBDMirror', 'cephrbdmirrors');
export const CephCOSIDriver = rook('CephCOSIDriver', 'cephcosidrivers');
export const CephNVMeOFGateway = rook('CephNVMeOFGateway', 'cephnvmeofgateways');

export class ObjectBucketClaim extends KubeObject<J> {
  static kind = 'ObjectBucketClaim';
  static apiName = 'objectbucketclaims';
  static apiVersion = 'objectbucket.io/v1alpha1';
  static isNamespaced = true;
}

export class ObjectBucket extends KubeObject<J> {
  static kind = 'ObjectBucket';
  static apiName = 'objectbuckets';
  static apiVersion = 'objectbucket.io/v1alpha1';
  static isNamespaced = false;
}

/** Ceph-CSI operator (Rook 1.17+): one Driver per CSI driver (rbd, cephfs, nfs). */
export class CsiDriver extends KubeObject<J> {
  static kind = 'Driver';
  static apiName = 'drivers';
  static apiVersion = 'csi.ceph.io/v1';
  static isNamespaced = true;
}

export class CsiCephConnection extends KubeObject<J> {
  static kind = 'CephConnection';
  static apiName = 'cephconnections';
  static apiVersion = 'csi.ceph.io/v1';
  static isNamespaced = true;
}

export class CsiClientProfile extends KubeObject<J> {
  static kind = 'ClientProfile';
  static apiName = 'clientprofiles';
  static apiVersion = 'csi.ceph.io/v1';
  static isNamespaced = true;
}

export class VolumeSnapshotClass extends KubeObject<J> {
  static kind = 'VolumeSnapshotClass';
  static apiName = 'volumesnapshotclasses';
  static apiVersion = 'snapshot.storage.k8s.io/v1';
  static isNamespaced = false;
}

export class VolumeSnapshot extends KubeObject<J> {
  static kind = 'VolumeSnapshot';
  static apiName = 'volumesnapshots';
  static apiVersion = 'snapshot.storage.k8s.io/v1';
  static isNamespaced = true;
}

export class VolumeSnapshotContent extends KubeObject<J> {
  static kind = 'VolumeSnapshotContent';
  static apiName = 'volumesnapshotcontents';
  static apiVersion = 'snapshot.storage.k8s.io/v1';
  static isNamespaced = false;
}

export class VirtualMachine extends KubeObject<J> {
  static kind = 'VirtualMachine';
  static apiName = 'virtualmachines';
  static apiVersion = 'kubevirt.io/v1';
  static isNamespaced = true;
}

/** API group/version and plural of each kind Cairn writes, for paths and permissions. */
export const KINDS = {
  CephCluster: { apiVersion: 'ceph.rook.io/v1', plural: 'cephclusters' },
  CephBlockPool: { apiVersion: 'ceph.rook.io/v1', plural: 'cephblockpools' },
  CephBlockPoolRadosNamespace: { apiVersion: 'ceph.rook.io/v1', plural: 'cephblockpoolradosnamespaces' },
  CephFilesystem: { apiVersion: 'ceph.rook.io/v1', plural: 'cephfilesystems' },
  CephFilesystemSubVolumeGroup: { apiVersion: 'ceph.rook.io/v1', plural: 'cephfilesystemsubvolumegroups' },
  CephObjectStore: { apiVersion: 'ceph.rook.io/v1', plural: 'cephobjectstores' },
  CephObjectStoreUser: { apiVersion: 'ceph.rook.io/v1', plural: 'cephobjectstoreusers' },
  CephClient: { apiVersion: 'ceph.rook.io/v1', plural: 'cephclients' },
  CephNFS: { apiVersion: 'ceph.rook.io/v1', plural: 'cephnfses' },
  CephRBDMirror: { apiVersion: 'ceph.rook.io/v1', plural: 'cephrbdmirrors' },
  ObjectBucketClaim: { apiVersion: 'objectbucket.io/v1alpha1', plural: 'objectbucketclaims' },
  StorageClass: { apiVersion: 'storage.k8s.io/v1', plural: 'storageclasses' },
  VolumeSnapshotClass: { apiVersion: 'snapshot.storage.k8s.io/v1', plural: 'volumesnapshotclasses' },
  VolumeSnapshot: { apiVersion: 'snapshot.storage.k8s.io/v1', plural: 'volumesnapshots' },
} as const;

export type KindName = keyof typeof KINDS;

/** Core v1 Event (not in Headlamp's ResourceClasses). */
export class KubeEvent extends KubeObject<J> {
  static kind = 'Event';
  static apiName = 'events';
  static apiVersion = 'v1';
  static isNamespaced = true;
}
