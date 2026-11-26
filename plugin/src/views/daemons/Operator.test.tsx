import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { K4ALL_MANAGED } from '../../model/ownership';
import { Obj } from '../../model/types';
import { Operator } from './Operator';

/** cc: the listed CephCluster; got: what a GET of it returns (an Error: the GET fails); gets: the paths read. */
const state: { cc: Obj | null; got: Obj | Error | null; gets: string[]; k4all: boolean } = { cc: null, got: null, gets: [], k4all: true };

vi.mock('../../api/client', async orig => {
  const get = async (path: string) => {
    state.gets.push(path);
    if (!state.got) throw Object.assign(new Error('not found'), { status: 404 });
    if (state.got instanceof Error) throw state.got;
    return state.got;
  };
  return { ...((await orig()) as object), currentCluster: () => 'main', kreq: get, kget: get };
});

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

/** The CephCluster as Headlamp's list hands it out: v0.46 deletes metadata.managedFields from listed objects. */
function listed(o: Obj): Obj {
  const c = JSON.parse(JSON.stringify(o));
  delete c.metadata.managedFields;
  return c;
}

/** The listed CephCluster, and the GET with the managedFields `imageBy` wrote. */
function serve(imageBy: string) {
  state.got = cephCluster(imageBy);
  state.cc = listed(state.got);
}

/** Renders the page and lets the GET of the CephCluster answer. */
async function page() {
  const r = render(
    <MemoryRouter>
      <Operator />
    </MemoryRouter>
  );
  await act(() => new Promise(done => setTimeout(done, 0)));
  return r;
}

describe('the Ceph image of the CephCluster', () => {
  beforeEach(() => {
    state.k4all = true;
    state.gets = [];
  });

  it('is k4all’s when k4all-operator applies it (D18): read-only, with the addon’s storage page', async () => {
    serve('k4all-operator');
    await page();
    expect(screen.getByText(K4ALL_MANAGED)).toBeTruthy();
    expect(screen.getByText('Open the k4all addon').getAttribute('href')).toBe('/c/main/k4all/settings/storage');
  });

  it('is read from a GET of the CephCluster: the listed copy has no managedFields', async () => {
    serve('k4all-operator');
    await page();
    expect(state.gets).toEqual(['/apis/ceph.rook.io/v1/namespaces/rook-ceph/cephclusters/rook-ceph']);
  });

  it('is not marked when the GET fails', async () => {
    serve('k4all-operator');
    state.got = Object.assign(new Error('Forbidden'), { status: 403 });
    await page();
    expect(state.gets).toHaveLength(1);
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
  });

  it('is not marked when only the seed or an admin wrote it', async () => {
    serve('k4all-operator-seed');
    await page();
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
    serve('kubectl-patch');
    await page();
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
  });

  it('is not marked when k4all does not run the cluster', async () => {
    serve('k4all-operator');
    state.k4all = false;
    await page();
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
    expect(state.gets).toEqual([]);
  });
});
