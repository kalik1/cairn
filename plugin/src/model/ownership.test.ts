import { fieldManagers, fieldsCover, k4allOwnedFields, ownedBy, ownedByK4all } from './ownership';
import { Obj } from './types';

/*
 * managedFields as the API server returns them (kubectl get -o json
 * --show-managed-fields), status and unrelated fields trimmed.
 */

/** A CephCluster created with kubectl apply, then patched; Rook writes the finalizer and the status. */
const CC_BY_HAND: Obj = {
  apiVersion: 'ceph.rook.io/v1',
  kind: 'CephCluster',
  metadata: {
    name: 'rook-ceph',
    namespace: 'rook-ceph',
    managedFields: [
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:metadata': { 'f:finalizers': { '.': {}, 'v:"cephcluster.ceph.rook.io"': {} } } },
        manager: 'rook',
        operation: 'Update',
        time: '2026-01-10T09:00:00Z',
      },
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: {
          'f:metadata': { 'f:annotations': { '.': {}, 'f:kubectl.kubernetes.io/last-applied-configuration': {} } },
          'f:spec': {
            '.': {},
            'f:cephVersion': { '.': {}, 'f:image': {} },
            'f:dataDirHostPath': {},
            'f:mgr': { '.': {}, 'f:count': {}, 'f:modules': {} },
            'f:mon': { '.': {}, 'f:allowMultiplePerNode': {}, 'f:count': {} },
            'f:storage': { '.': {}, 'f:deviceFilter': {}, 'f:useAllDevices': {}, 'f:useAllNodes': {} },
          },
        },
        manager: 'kubectl-client-side-apply',
        operation: 'Update',
        time: '2026-01-10T09:00:00Z',
      },
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:spec': { 'f:security': { '.': {}, 'f:cephx': { '.': {}, 'f:allowedCiphers': { '.': {}, 'v:"aes256k"': {} } } } } },
        manager: 'kubectl-patch',
        operation: 'Update',
        time: '2026-01-11T09:00:00Z',
      },
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:status': { '.': {}, 'f:phase': {}, 'f:observedGeneration': {}, 'f:conditions': {} } },
        manager: 'rook',
        operation: 'Update',
        subresource: 'status',
        time: '2026-01-11T09:01:00Z',
      },
    ],
  },
  spec: { mgr: { count: 1, modules: [{ name: 'rook', enabled: true }] }, mon: { count: 3 } },
};

/**
 * A CephCluster a platform operator applies with server-side apply and
 * field manager k4all-operator: it owns the mon count and the module list,
 * an admin later changed the manager count with kubectl patch.
 */
const CC_BY_K4ALL: Obj = {
  apiVersion: 'ceph.rook.io/v1',
  kind: 'CephCluster',
  metadata: {
    name: 'rook-ceph',
    namespace: 'rook-ceph',
    managedFields: [
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: {
          'f:spec': {
            'f:cephVersion': { 'f:image': {} },
            'f:dataDirHostPath': {},
            'f:mgr': { 'f:modules': {} },
            'f:mon': { 'f:allowMultiplePerNode': {}, 'f:count': {} },
          },
        },
        manager: 'k4all-operator',
        operation: 'Apply',
        time: '2026-02-01T10:00:00Z',
      },
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:spec': { 'f:mgr': { 'f:count': {} } } },
        manager: 'kubectl-patch',
        operation: 'Update',
        time: '2026-02-02T10:00:00Z',
      },
    ],
  },
  spec: { mgr: { count: 2, modules: [] }, mon: { count: 3 } },
};

/** CDI as k4all applies it: a real k4all-operator entry next to the CDI operator's. */
const CDI: Obj = {
  apiVersion: 'cdi.kubevirt.io/v1beta1',
  kind: 'CDI',
  metadata: {
    name: 'cdi',
    managedFields: [
      {
        apiVersion: 'cdi.kubevirt.io/v1beta1',
        fieldsType: 'FieldsV1',
        fieldsV1: {
          'f:spec': {
            'f:config': { 'f:featureGates': {} },
            'f:imagePullPolicy': {},
            'f:infra': { 'f:nodeSelector': { 'f:kubernetes.io/os': {} } },
            'f:workload': { 'f:nodeSelector': { 'f:kubernetes.io/os': {} } },
          },
        },
        manager: 'k4all-operator',
        operation: 'Apply',
        time: '2026-02-01T10:00:00Z',
      },
      {
        apiVersion: 'cdi.kubevirt.io/v1beta1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:metadata': { 'f:finalizers': { '.': {}, 'v:"operator.cdi.kubevirt.io"': {} } }, 'f:spec': { 'f:config': { '.': {}, 'f:dataVolumeTTLSeconds': {} } } },
        manager: 'cdi-operator',
        operation: 'Update',
        time: '2026-02-01T10:00:05Z',
      },
    ],
  },
};

describe('field ownership from managedFields', () => {
  it('names the managers of a field', () => {
    expect(fieldManagers(CC_BY_HAND, 'spec.mgr.count')).toEqual(['kubectl-client-side-apply']);
    expect(fieldManagers(CC_BY_HAND, 'spec.security.cephx.allowedCiphers')).toEqual(['kubectl-patch']);
    expect(fieldManagers(CC_BY_HAND, ['metadata', 'finalizers'])).toEqual(['rook']);
    expect(fieldManagers(CC_BY_HAND, 'status.phase')).toEqual(['rook']);
    expect(fieldManagers(CC_BY_HAND, 'spec.placement')).toEqual([]);
  });

  it('leaves a hand-made CephCluster editable', () => {
    for (const p of ['spec.mgr.count', 'spec.mon.count', 'spec.mgr.modules']) expect(ownedByK4all(CC_BY_HAND, p)).toBe(false);
    expect(k4allOwnedFields(CC_BY_HAND, ['spec.mgr.count', 'spec.mon.count', 'spec.mgr.modules'])).toEqual([]);
  });

  it('finds the fields the k4all operator applies', () => {
    expect(ownedByK4all(CC_BY_K4ALL, 'spec.mon.count')).toBe(true);
    expect(ownedByK4all(CC_BY_K4ALL, 'spec.mgr.modules')).toBe(true);
    // the manager count was taken over by kubectl patch: no longer k4all's
    expect(ownedByK4all(CC_BY_K4ALL, 'spec.mgr.count')).toBe(false);
    expect(ownedBy(CC_BY_K4ALL, 'spec.mgr.count', 'kubectl-patch')).toBe(true);
    expect(k4allOwnedFields(CC_BY_K4ALL, ['spec.mgr.count', 'spec.mon.count', 'spec.mgr.modules'])).toEqual(['spec.mon.count', 'spec.mgr.modules']);
  });

  it('reads a real k4all-operator entry on another kind', () => {
    expect(ownedByK4all(CDI, 'spec.config.featureGates')).toBe(true);
    expect(ownedByK4all(CDI, 'spec.infra.nodeSelector')).toBe(true);
    expect(ownedByK4all(CDI, ['spec', 'infra', 'nodeSelector', 'kubernetes.io/os'])).toBe(true);
    expect(ownedByK4all(CDI, 'spec.config.dataVolumeTTLSeconds')).toBe(false);
    expect(fieldManagers(CDI, 'spec.config.dataVolumeTTLSeconds')).toEqual(['cdi-operator']);
  });

  it('a parent owned only for its existence does not own its children', () => {
    // "f:mgr": {".": {}, …} belongs to kubectl; ".": {} alone owns nothing below
    expect(fieldsCover({ 'f:spec': { 'f:mgr': { '.': {} } } }, 'spec.mgr.count')).toBe(false);
    expect(fieldsCover({ 'f:spec': { 'f:mgr': { '.': {} } } }, 'spec.mgr')).toBe(true);
  });

  it('an atomic value owns everything inside it', () => {
    expect(fieldsCover({ 'f:spec': { 'f:mgr': { 'f:modules': {} } } }, ['spec', 'mgr', 'modules', 'k:{"name":"rook"}', 'enabled'])).toBe(true);
    expect(fieldsCover({ 'f:spec': { 'f:mgr': {} } }, 'spec.mgr.count')).toBe(true);
  });

  it('reads a list kept as a map by key', () => {
    const f = { 'f:spec': { 'f:mgr': { 'f:modules': { 'k:{"name":"pg_autoscaler"}': { '.': {}, 'f:enabled': {}, 'f:name': {} } } } } };
    expect(fieldsCover(f, 'spec.mgr.modules')).toBe(true);
    expect(fieldsCover(f, ['spec', 'mgr', 'modules', 'k:{"name":"pg_autoscaler"}', 'enabled'])).toBe(true);
    expect(fieldsCover(f, ['spec', 'mgr', 'modules', 'k:{"name":"rook"}'])).toBe(false);
  });

  it('copes with missing or odd managedFields', () => {
    expect(fieldManagers(null, 'spec.mgr.count')).toEqual([]);
    expect(fieldManagers({ metadata: { name: 'x' } }, 'spec.mgr.count')).toEqual([]);
    expect(fieldManagers({ metadata: { name: 'x', managedFields: [null, { manager: 'k4all-operator' }] } as any }, 'spec.mgr.count')).toEqual([]);
    expect(fieldManagers({ metadata: { name: 'x', managedFields: [{ manager: 'k4all-operator', fieldsType: 'FieldsV2', fieldsV1: { 'f:spec': {} } }] } as any }, 'spec')).toEqual([]);
    expect(fieldsCover({}, 'spec')).toBe(false);
    expect(fieldsCover({ 'f:spec': {} }, '')).toBe(false);
  });
});
