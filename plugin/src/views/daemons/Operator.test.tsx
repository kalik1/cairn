import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { K4ALL_MANAGED } from '../../model/ownership';
import { Obj } from '../../model/types';
import { Operator } from './Operator';

const state: { cc: Obj | null; k4all: boolean } = { cc: null, k4all: true };

vi.mock('../../api/kube', () => ({
  useKube: () => ({ cephCluster: state.cc, ns: 'rook-ceph', events: { items: [], loaded: true, forbidden: false }, refresh: () => undefined }),
}));
vi.mock('./useOperator', () => ({ useOperator: () => ({ looked: true, deployment: null, pods: [] }) }));
vi.mock('../../api/k4all', () => ({ useK4all: () => state.k4all, isK4all: async () => state.k4all }));
vi.mock('../overview/common', async orig => ({
  ...((await orig()) as object),
  headlampUrl: (route: string) => (route === 'k4all-settings' ? '/c/main/k4all/settings' : null),
}));

/** A CephCluster k4all created (k4all-operator-seed); `imageBy` applied the Ceph image. */
function cephCluster(imageBy: string): Obj {
  return {
    apiVersion: 'ceph.rook.io/v1',
    kind: 'CephCluster',
    metadata: {
      name: 'rook-ceph',
      namespace: 'rook-ceph',
      generation: 2,
      managedFields: [
        {
          manager: 'k4all-operator-seed',
          operation: 'Update',
          fieldsType: 'FieldsV1',
          fieldsV1: { 'f:spec': { '.': {}, 'f:cephVersion': { '.': {} }, 'f:mgr': { '.': {}, 'f:count': {} }, 'f:mon': { '.': {}, 'f:count': {} } } },
        },
        { manager: imageBy, operation: imageBy === 'k4all-operator' ? 'Apply' : 'Update', fieldsType: 'FieldsV1', fieldsV1: { 'f:spec': { 'f:cephVersion': { 'f:image': {} } } } },
      ],
    },
    spec: { cephVersion: { image: 'quay.io/ceph/ceph:v20.2.4' }, mgr: { count: 1 }, mon: { count: 3 } },
    status: { phase: 'Ready', observedGeneration: 2, version: { version: '20.2.4-0', image: 'quay.io/ceph/ceph:v20.2.4' } },
  };
}

const page = () =>
  render(
    <MemoryRouter>
      <Operator />
    </MemoryRouter>
  );

describe('the Ceph image of the CephCluster', () => {
  beforeEach(() => {
    state.k4all = true;
  });

  it('is k4all’s when k4all-operator applies it (D18): read-only, with the addon’s storage page', () => {
    state.cc = cephCluster('k4all-operator');
    page();
    expect(screen.getByText(K4ALL_MANAGED)).toBeTruthy();
    expect(screen.getByText('Open the k4all addon').getAttribute('href')).toBe('/c/main/k4all/settings/storage');
  });

  it('is not marked when only the seed or an admin wrote it', () => {
    state.cc = cephCluster('k4all-operator-seed');
    page();
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
    state.cc = cephCluster('kubectl-patch');
    page();
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
  });

  it('is not marked when k4all does not run the cluster', () => {
    state.cc = cephCluster('k4all-operator');
    state.k4all = false;
    page();
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
  });
});
