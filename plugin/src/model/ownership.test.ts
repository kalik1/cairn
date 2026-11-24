import { fieldManagers, fieldsCover, k4allOwnedFields, k4allOwns, ownedBy, ownedByK4all } from './ownership';
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

/**
 * The CephCluster k4all creates once (RookHook, field manager
 * k4all-operator-seed, a create: operation Update), then: k4all applied a
 * newer Ceph image (D18, field manager k4all-operator, which took the image
 * over from the seed entry), Cairn changed the manager count (Headlamp's
 * requests are recorded under the browser's user agent), Rook added its
 * finalizer and the status.
 */
const CC_SEEDED: Obj = {
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
            '.': {},
            'f:cephVersion': { '.': {}, 'f:allowUnsupported': {} },
            'f:dataDirHostPath': {},
            'f:mgr': { '.': {}, 'f:modules': {} },
            'f:mon': { '.': {}, 'f:allowMultiplePerNode': {}, 'f:count': {} },
            'f:security': { '.': {}, 'f:cephx': { '.': {}, 'f:allowedCiphers': {} } },
            'f:storage': { '.': {}, 'f:useAllDevices': {}, 'f:useAllNodes': {} },
          },
        },
        manager: 'k4all-operator-seed',
        operation: 'Update',
        time: '2026-11-24T08:00:00Z',
      },
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:spec': { 'f:cephVersion': { 'f:image': {} } } },
        manager: 'k4all-operator',
        operation: 'Apply',
        time: '2026-12-10T08:00:00Z',
      },
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:spec': { 'f:mgr': { 'f:count': {} } } },
        manager: 'Headlamp unknown (linux',
        operation: 'Update',
        time: '2026-11-25T10:00:00Z',
      },
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:metadata': { 'f:finalizers': { '.': {}, 'v:"cephcluster.ceph.rook.io"': {} } } },
        manager: 'rook',
        operation: 'Update',
      },
      {
        apiVersion: 'ceph.rook.io/v1',
        fieldsType: 'FieldsV1',
        fieldsV1: { 'f:status': { '.': {}, 'f:phase': {}, 'f:version': {} } },
        manager: 'rook',
        operation: 'Update',
        subresource: 'status',
      },
    ],
  },
  spec: {
    cephVersion: { image: 'quay.io/ceph/ceph:v20.2.5', allowUnsupported: false },
    dataDirHostPath: '/var/lib/rook',
    mgr: { count: 2, modules: [{ name: 'pg_autoscaler', enabled: true }] },
    mon: { count: 3, allowMultiplePerNode: false },
    security: { cephx: { allowedCiphers: ['aes256k'] } },
    storage: { useAllNodes: true, useAllDevices: true },
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

  it('a list or a scalar under {} is owned as a whole', () => {
    const live: Obj = { metadata: { name: 'x' }, spec: { mgr: { count: 1, modules: [{ name: 'rook', enabled: true }] }, image: 'quay.io/ceph/ceph:v20' } };
    expect(fieldsCover({ 'f:spec': { 'f:mgr': { 'f:modules': {} } } }, ['spec', 'mgr', 'modules', 'k:{"name":"rook"}', 'enabled'], live)).toBe(true);
    expect(fieldsCover({ 'f:spec': { 'f:mgr': { 'f:modules': {} } } }, ['spec', 'mgr', 'modules', 'i:0'], live)).toBe(true);
    expect(fieldsCover({ 'f:spec': { 'f:image': {} } }, 'spec.image.tag', live)).toBe(true);
  });

  it('an empty struct above the field owns none of its children (R9)', () => {
    // an applied `mgr: {}` (or a struct someone else filled later): the count is not its
    const live: Obj = { metadata: { name: 'x' }, spec: { mgr: { count: 2 } } };
    expect(fieldsCover({ 'f:spec': { 'f:mgr': {} } }, 'spec.mgr.count', live)).toBe(false);
    expect(fieldsCover({ 'f:spec': { 'f:mgr': {} } }, 'spec.mgr', live)).toBe(true);
    // no live value there, or no live object at all: nothing below is owned
    expect(fieldsCover({ 'f:spec': { 'f:mgr': {} } }, 'spec.mgr.count', { metadata: { name: 'x' }, spec: {} })).toBe(false);
    expect(fieldsCover({ 'f:spec': { 'f:mgr': {} } }, 'spec.mgr.count')).toBe(false);
    const cc: Obj = {
      metadata: {
        name: 'rook-ceph',
        managedFields: [{ manager: 'k4all-operator', operation: 'Apply', fieldsType: 'FieldsV1', fieldsV1: { 'f:spec': { 'f:mgr': {}, 'f:healthCheck': {} } } }],
      },
      spec: { mgr: { count: 2 }, healthCheck: { daemonHealth: { mon: { interval: '45s' } } } },
    };
    expect(k4allOwnedFields(cc, ['spec.mgr.count', 'spec.healthCheck.daemonHealth.mon.interval'])).toEqual([]);
  });

  it('a create-only CephCluster with only the Ceph image applied by k4all (D18)', () => {
    expect(fieldManagers(CC_SEEDED, 'spec.cephVersion.image')).toEqual(['k4all-operator']);
    expect(ownedByK4all(CC_SEEDED, 'spec.cephVersion.image')).toBe(true);
    expect(k4allOwns(CC_SEEDED, 'spec.cephVersion.image', true)).toBe(true);
    // the rest was created by k4all-operator-seed (create-only) or changed in Cairn: editable
    const rest = ['spec.mgr.count', 'spec.mgr.modules', 'spec.mon.count', 'spec.mon.allowMultiplePerNode', 'spec.storage.useAllDevices', 'spec.security.cephx.allowedCiphers', 'spec.cephVersion.allowUnsupported'];
    expect(k4allOwnedFields(CC_SEEDED, rest)).toEqual([]);
    expect(fieldManagers(CC_SEEDED, 'spec.mon.count')).toEqual(['k4all-operator-seed']);
    expect(fieldManagers(CC_SEEDED, 'spec.mgr.count')).toEqual(['Headlamp unknown (linux']);
  });

  it('without k4all everything is Cairn’s', () => {
    expect(k4allOwns(CC_SEEDED, 'spec.cephVersion.image', false)).toBe(false);
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
