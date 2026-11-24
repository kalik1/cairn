import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { K4ALL_MANAGED } from '../../model/ownership';
import { Obj } from '../../model/types';
import { MgrCountPanel, MonCountPanel } from './counts';

const state: { cc: Obj | null; nodes: Obj[]; settings: string; k4all: boolean } = { cc: null, nodes: [], settings: '', k4all: false };

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
    spec: { mon: { count: 3, allowMultiplePerNode: false }, mgr: { count: 1 } },
  };
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
  });

  it('lets an admin change counts on a hand-made CephCluster, with 5 monitors off on three nodes', () => {
    state.cc = cephCluster(byHand);
    render(
      <MemoryRouter>
        <MgrCountPanel />
        <MonCountPanel />
      </MemoryRouter>
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

  it('shows k4all-owned counts read-only, with a link to the addon’s storage page when it is loaded', () => {
    state.cc = cephCluster(byK4all);
    state.settings = '/c/main/k4all/settings';
    render(
      <MemoryRouter>
        <MgrCountPanel />
        <MonCountPanel />
      </MemoryRouter>
    );
    expect(screen.getAllByText(K4ALL_MANAGED)).toHaveLength(2);
    expect([...radios('Number of managers'), ...radios('Number of monitors')].every(r => r.disabled)).toBe(true);
    const links = screen.getAllByText('Open the k4all addon') as HTMLAnchorElement[];
    expect(links[0].getAttribute('href')).toBe('/c/main/k4all/settings/storage');
  });

  it('without the k4all addon loaded, says where to change it without a link', () => {
    state.cc = cephCluster(byK4all);
    render(
      <MemoryRouter>
        <MgrCountPanel />
      </MemoryRouter>
    );
    expect(screen.getByText(K4ALL_MANAGED)).toBeTruthy();
    expect(screen.queryByText('Open the k4all addon')).toBeNull();
  });

  it('leaves counts editable when k4all does not run the cluster, whatever managedFields say', () => {
    state.cc = cephCluster(byK4all);
    state.k4all = false;
    render(
      <MemoryRouter>
        <MgrCountPanel />
        <MonCountPanel />
      </MemoryRouter>
    );
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
    expect(radios('Number of managers').some(r => !r.disabled)).toBe(true);
  });

  it('leaves the seed’s counts editable (k4all-operator-seed is not an owner)', () => {
    state.cc = cephCluster(byK4all.map(e => ({ ...e, manager: 'k4all-operator-seed', operation: 'Update' })));
    render(
      <MemoryRouter>
        <MgrCountPanel />
        <MonCountPanel />
      </MemoryRouter>
    );
    expect(screen.queryByText(K4ALL_MANAGED)).toBeNull();
  });
});
