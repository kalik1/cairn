import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { KubeProvider, useKube } from './kube';

/*
 * Headlamp's list hooks list, then watch, but only a list without
 * refetchInterval: useKubeObjectList's `shouldWatch = watch &&
 * !refetchInterval && !query.isLoading` (headlamp-plugin 0.14.0,
 * lib/k8s/api/v2/useKubeObjectList.js). A polled list sees a change at its
 * next poll. The fake classes below keep that rule: a change made on the
 * cluster (emit) reaches the watched lists at once and the polled ones not
 * until a poll, which these tests never wait for.
 */

const h = vi.hoisted(() => {
  const stores = new Map<string, { items: any[]; listeners: Set<() => void> }>();
  const opts = new Map<string, any>();
  const store = (kind: string) => {
    if (!stores.has(kind)) stores.set(kind, { items: [], listeners: new Set() });
    return stores.get(kind)!;
  };
  const fake = (kind: string) => ({
    kind,
    useList(o: any = {}) {
      opts.set(kind, o);
      const s = store(kind);
      const watched = !o.refetchInterval;
      const [items, setItems] = React.useState(s.items);
      React.useEffect(() => {
        if (!watched) return;
        const l = () => setItems(s.items);
        s.listeners.add(l);
        return () => {
          s.listeners.delete(l);
        };
      }, [watched]);
      return { items, error: null };
    },
  });
  /** A change on the cluster: the list of `kind` is now `items`. */
  const emit = (kind: string, items: any[]) => {
    const s = store(kind);
    s.items = items;
    s.listeners.forEach(l => l());
  };
  const reset = () => {
    stores.clear();
    opts.clear();
  };
  return { fake, emit, opts, reset, store };
});

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ K8s: { ResourceClasses: new Proxy({}, { get: (_t, kind: string) => h.fake(kind) }) } }));
vi.mock('./resources', () =>
  Object.fromEntries(
    [
      'CephBlockPool',
      'CephBlockPoolRadosNamespace',
      'CephClient',
      'CephCluster',
      'CephFilesystem',
      'CephFilesystemMirror',
      'CephFilesystemSubVolumeGroup',
      'CephNFS',
      'CephNVMeOFGateway',
      'CephObjectStore',
      'CephObjectStoreUser',
      'CephObjectZone',
      'CephRBDMirror',
      'CsiDriver',
      'KubeEvent',
      'ObjectBucketClaim',
      'VolumeSnapshotClass',
    ].map(kind => [kind, h.fake(kind)])
  )
);
vi.mock('./client', () => ({ currentCluster: () => 'main' }));

const sc = (name: string) => ({ apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name, uid: `uid-${name}`, resourceVersion: '1' }, provisioner: 'rook-ceph.rbd.csi.ceph.com' });
const vsc = (name: string) => ({ apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshotClass', metadata: { name, uid: `uid-${name}`, resourceVersion: '1' }, driver: 'rook-ceph.rbd.csi.ceph.com' });

function Names() {
  const k = useKube();
  return (
    <>
      <div data-testid="sc">{k.storageClasses.items.map(o => o.metadata.name).join(',')}</div>
      <div data-testid="vsc">{k.snapshotClasses.items.map(o => o.metadata.name).join(',')}</div>
      <div data-testid="pools">{k.blockPools.items.map(o => o.metadata.name).join(',')}</div>
    </>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe('StorageClass and VolumeSnapshotClass lists', () => {
  beforeEach(() => {
    h.reset();
    h.store('StorageClass').items = [sc('ceph-rbd')];
    h.store('VolumeSnapshotClass').items = [vsc('ceph-rbd-snap')];
    h.store('CephBlockPool').items = [{ metadata: { name: 'replicapool', namespace: 'rook-ceph', uid: 'p1', resourceVersion: '1' } }];
    render(
      <KubeProvider>
        <Names />
      </KubeProvider>
    );
  });

  it('are watched: no refetchInterval', () => {
    expect(h.opts.get('StorageClass')?.refetchInterval).toBeUndefined();
    expect(h.opts.get('VolumeSnapshotClass')?.refetchInterval).toBeUndefined();
    // A list that stays polled, for contrast.
    expect(h.opts.get('CephBlockPool')?.refetchInterval).toBe(15000);
  });

  it('show a class created elsewhere at once, without a poll', () => {
    expect(text('sc')).toBe('ceph-rbd');
    expect(text('vsc')).toBe('ceph-rbd-snap');
    act(() => {
      h.emit('StorageClass', [sc('ceph-rbd'), sc('ceph-fs')]);
      h.emit('VolumeSnapshotClass', [vsc('ceph-rbd-snap'), vsc('ceph-fs-snap')]);
    });
    expect(text('sc')).toBe('ceph-rbd,ceph-fs');
    expect(text('vsc')).toBe('ceph-rbd-snap,ceph-fs-snap');
  });

  it('drop a class deleted elsewhere at once', () => {
    act(() => {
      h.emit('StorageClass', []);
      h.emit('VolumeSnapshotClass', []);
    });
    expect(text('sc')).toBe('');
    expect(text('vsc')).toBe('');
  });

  it('(a polled list waits for its poll)', () => {
    act(() => h.emit('CephBlockPool', []));
    expect(text('pools')).toBe('replicapool');
  });
});
