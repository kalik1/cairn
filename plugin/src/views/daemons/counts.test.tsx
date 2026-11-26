import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { K4ALL_MANAGED } from '../../model/ownership';
import { Obj } from '../../model/types';
import { previewChange } from '../../ui/ChangeDialog';
import { MgrCountPanel, MonCountPanel, previewRemoveModule, useModulesEditReason } from './counts';

/** cc: the listed CephCluster; got: what a GET of it returns (an Error: the GET fails); gets: the paths read. */
const state: { cc: Obj | null; got: Obj | Error | null; gets: string[]; nodes: Obj[]; settings: string; k4all: boolean } = {
  cc: null,
  got: null,
  gets: [],
  nodes: [],
  settings: '',
  k4all: false,
};

vi.mock('../../api/client', async orig => {
  const get = async (path: string) => {
    state.gets.push(path);
    if (!state.got) throw Object.assign(new Error('not found'), { status: 404 });
    if (state.got instanceof Error) throw state.got;
    return state.got;
  };
  return { ...((await orig()) as object), currentCluster: () => 'main', kreq: get, kget: get };
});
vi.mock('../../ui/ChangeDialog', () => ({ previewChange: vi.fn(async () => true) }));

vi.mock('../../api/k4all', () => ({ useK4all: () => state.k4all, isK4all: async () => state.k4all }));

vi.mock('../../api/kube', () => ({
  useKube: () => ({ cephCluster: state.cc, nodes: { items: state.nodes, loaded: true, error: null }, refresh: () => undefined }),
}));
vi.mock('../../api/ceph', () => ({
  useCeph: () => ({
    core: {
      mgr: { active: 'a', standbys: [], available: true, modules: [], alwaysOn: [], services: {}, activeSince: null },
      quorum: {
        leader: 'a',
        quorum: ['a', 'b', 'c'],
        ageSec: 100,
        mons: ['a', 'b', 'c'].map((name, rank) => ({ name, rank, addr: '', inQuorum: true, leader: rank === 0 })),
        allowedCiphers: [],
        preferredCipher: '',
        serviceCipher: '',
        minMonRelease: '',
      },
      versions: null,
    },
  }),
}));
vi.mock('../overview/common', async orig => ({
  ...((await orig()) as object),
  useClusterEditReason: () => null,
  headlampUrl: (route: string) => (route === 'k4all-settings' ? state.settings : null),
}));

const node = (name: string): Obj => ({ apiVersion: 'v1', kind: 'Node', metadata: { name, labels: {} }, spec: {} });

function cephCluster(managedFields: any[]): Obj {
  return {
    apiVersion: 'ceph.rook.io/v1',
    kind: 'CephCluster',
    metadata: { name: 'rook-ceph', namespace: 'rook-ceph', managedFields },
    spec: { mon: { count: 3, allowMultiplePerNode: false }, mgr: { count: 1, modules: [{ name: 'pg_autoscaler', enabled: true }] } },
  };
}

/**
 * The CephCluster as a GET returns it, with these managedFields, and as
 * Headlamp's list hands it out: v0.46 deletes metadata.managedFields from
 * listed objects.
 */
function serve(managedFields: any[]) {
  state.got = cephCluster(managedFields);
  state.cc = cephCluster(managedFields);
  delete state.cc.metadata.managedFields;
}

/** Renders the panels and lets the GET of the CephCluster answer. */
async function show(el: React.ReactElement) {
  const r = render(<MemoryRouter>{el}</MemoryRouter>);
  await act(() => new Promise(done => setTimeout(done, 0)));
  return r;
}

const byHand = [
  {
    manager: 'kubectl-client-side-apply',
    operation: 'Update',
    fieldsType: 'FieldsV1',
    fieldsV1: { 'f:spec': { '.': {}, 'f:mgr': { '.': {}, 'f:count': {} }, 'f:mon': { '.': {}, 'f:allowMultiplePerNode': {}, 'f:count': {} } } },
  },
];
const byK4all = [
  {
    manager: 'k4all-operator',
    operation: 'Apply',
    fieldsType: 'FieldsV1',
    fieldsV1: { 'f:spec': { 'f:mgr': { 'f:count': {} }, 'f:mon': { 'f:allowMultiplePerNode': {}, 'f:count': {} } } },
  },
];

const radios = (label: string) => [...document.querySelectorAll(`[aria-label="${label}"] input[type=radio]`)] as HTMLInputElement[];

describe('count panels', () => {
  beforeEach(() => {
    state.nodes = ['node-a.example.com', 'node-b.example.com', 'node-c.example.com'].map(node);
    state.settings = '';
    state.k4all = true;
    state.gets = [];
    vi.mocked(previewChange).mockClear();
  });

  it('lets an admin change counts on a hand-made CephCluster, with 5 monitors off on three nodes', async () => {
    serve(byHand);
    await show(
      <>
        <MgrCountPanel />
        <MonCountPanel />
      </>
    );
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
    expect(radios('Number of managers').map(r => [r.value, r.checked, r.disabled])).toEqual([
      ['1', true, false],
      ['2', false, false],
    ]);
    expect(radios('Number of monitors').map(r => [r.value, r.checked, r.disabled])).toEqual([
      ['1', false, false],
      ['3', true, false],
      ['5', false, true],
    ]);
    expect(screen.getByText(/Needs 5 nodes that can run a monitor, one per node; 3 nodes can/)).toBeTruthy();
    expect(screen.getByText('Needs a confirmation')).toBeTruthy();
  });

  it('shows k4all-owned counts read-only, with a link to the addon’s storage page when it is loaded', async () => {
    serve(byK4all);
    state.settings = '/c/main/k4all/settings';
    await show(
      <>
        <MgrCountPanel />
        <MonCountPanel />
      </>
    );
    expect(screen.getAllByText(K4ALL_MANAGED)).toHaveLength(2);
    expect([...radios('Number of managers'), ...radios('Number of monitors')].every(r => r.disabled)).toBe(true);
    const links = screen.getAllByText('Open the k4all addon') as HTMLAnchorElement[];
    expect(links[0].getAttribute('href')).toBe('/c/main/k4all/settings/storage');
  });

  it('without the k4all addon loaded, says where to change it without a link', async () => {
    serve(byK4all);
    await show(<MgrCountPanel />);
    expect(screen.getByText(K4ALL_MANAGED)).toBeTruthy();
    expect(screen.queryByText('Open the k4all addon')).toBeNull();
  });

  it('leaves counts editable when k4all does not run the cluster, whatever managedFields say', async () => {
    serve(byK4all);
    state.cc = state.got as Obj;
    state.k4all = false;
    await show(
      <>
        <MgrCountPanel />
        <MonCountPanel />
      </>
    );
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
    expect(radios('Number of managers').some(r => !r.disabled)).toBe(true);
    expect(state.gets).toEqual([]);
  });

  it('reads who owns the counts from a GET of the CephCluster: the listed copy has no managedFields', async () => {
    serve(byK4all);
    await show(<MgrCountPanel />);
    expect(state.gets).toContain('/apis/ceph.rook.io/v1/namespaces/rook-ceph/cephclusters/rook-ceph');
    expect(screen.getByText(K4ALL_MANAGED)).toBeTruthy();
  });

  it('checks the owner again in the GET before a change: k4all took the count meanwhile', async () => {
    serve(byHand);
    await show(<MgrCountPanel />);
    fireEvent.click(radios('Number of managers')[1]);
    state.got = cephCluster(byK4all);
    fireEvent.click(screen.getByText('Preview change'));
    expect(await screen.findByText(K4ALL_MANAGED)).toBeTruthy();
    expect(previewChange).not.toHaveBeenCalled();
  });

  it('prepares no change when the GET before it fails on k4all: the listed copy cannot tell who owns the count', async () => {
    serve(byHand);
    await show(<MgrCountPanel />);
    fireEvent.click(radios('Number of managers')[1]);
    state.got = Object.assign(new Error('Service Unavailable'), { status: 503 });
    fireEvent.click(screen.getByText('Preview change'));
    expect(await screen.findByText(/cannot tell whether k4all owns spec\.mgr\.count/)).toBeTruthy();
    expect(previewChange).not.toHaveBeenCalled();
  });

  it('prepares the change after the GET when nobody but the admin owns the count', async () => {
    serve(byHand);
    await show(<MgrCountPanel />);
    fireEvent.click(radios('Number of managers')[1]);
    fireEvent.click(screen.getByText('Preview change'));
    await act(() => new Promise(done => setTimeout(done, 0)));
    expect(previewChange).toHaveBeenCalledTimes(1);
  });

  it('leaves the seed’s counts editable (k4all-operator-seed is not an owner)', async () => {
    serve(byK4all.map(e => ({ ...e, manager: 'k4all-operator-seed', operation: 'Update' })));
    await show(
      <>
        <MgrCountPanel />
        <MonCountPanel />
      </>
    );
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
  });
});

describe('the mgr module list', () => {
  const byK4allModules = [
    { manager: 'k4all-operator', operation: 'Apply', fieldsType: 'FieldsV1', fieldsV1: { 'f:spec': { 'f:mgr': { 'f:modules': {} } } } },
  ];

  beforeEach(() => {
    state.k4all = true;
    state.gets = [];
    vi.mocked(previewChange).mockClear();
  });

  it('is k4all’s when its GET says so, though the listed copy has no managedFields', async () => {
    serve(byK4allModules);
    const { result } = renderHook(() => useModulesEditReason());
    expect(result.current).toBeNull();
    await act(() => new Promise(done => setTimeout(done, 0)));
    expect(result.current).toBe(K4ALL_MANAGED);
  });

  it('is the admin’s otherwise', async () => {
    serve(byHand);
    const { result } = renderHook(() => useModulesEditReason());
    await act(() => new Promise(done => setTimeout(done, 0)));
    expect(result.current).toBeNull();
  });

  it('removing an entry checks the owner in the GET, and refuses when the GET fails on k4all', async () => {
    serve(byK4allModules);
    await expect(previewRemoveModule(state.cc!, 'pg_autoscaler', '20.2.4')).rejects.toThrow(K4ALL_MANAGED);
    state.got = Object.assign(new Error('Service Unavailable'), { status: 503 });
    await expect(previewRemoveModule(state.cc!, 'pg_autoscaler', '20.2.4')).rejects.toThrow(/cannot tell whether k4all owns spec\.mgr\.modules/);
    expect(previewChange).not.toHaveBeenCalled();
  });
});
