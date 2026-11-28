import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { K4ALL_CEPHFS_OFF, WizardContext } from '../../model/storageclass';
import { DialogHost } from '../../ui/dialogs';
import { runClassWizard } from './ClassWizard';

vi.mock('../../api/k8sOps', () => ({ createClassFlow: vi.fn(async () => 'done') }));

const ctx: WizardContext = {
  ns: 'rook-ceph',
  storageClasses: [
    {
      metadata: { name: 'ceph-rbd' },
      provisioner: 'rook-ceph.rbd.csi.ceph.com',
      parameters: { clusterID: 'rook-ceph', 'csi.storage.k8s.io/provisioner-secret-name': 'rook-csi-rbd-provisioner' },
    },
  ],
  snapshotClasses: [{ metadata: { name: 'ceph-rbd-snapshot' }, driver: 'rook-ceph.rbd.csi.ceph.com' }],
  drivers: [{ metadata: { name: 'rook-ceph.rbd.csi.ceph.com', namespace: 'rook-ceph' } }],
  filesystems: [],
  blockPools: [{ metadata: { name: 'vm-pool', namespace: 'rook-ceph' } }, { metadata: { name: 'test-k8s-pool', namespace: 'rook-ceph' } }],
};

describe('StorageClass wizard', () => {
  it('turns the snapshot class on and shows its fields', async () => {
    render(<DialogHost />);
    act(() => {
      runClassWizard(ctx, { cephPools: [] }, () => undefined);
    });
    fireEvent.click(await screen.findByText('Disks for virtual machines'));
    const box = document.querySelector('input[name=vsc-create]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect((document.querySelector('input[name=vsc-create]') as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByDisplayValue('vm-pool-vm-snapshot')).toBeTruthy();
  });
});

describe('the CephFS preset and the CephFS driver', () => {
  // CephFS off in k4all: the seeded filesystem and class remain, the ceph-csi Driver of CephFS is gone.
  const fsCtx = (k4all: boolean): WizardContext => ({
    ...ctx,
    filesystems: [{ metadata: { name: 'cephfs', namespace: 'rook-ceph' } }],
    storageClasses: [...ctx.storageClasses, { metadata: { name: 'ceph-cephfs' }, provisioner: 'rook-ceph.cephfs.csi.ceph.com', parameters: { clusterID: 'rook-ceph', fsName: 'cephfs' } }],
    driversKnown: true,
    k4all,
    k4allAddonUrl: k4all ? '/c/main/k4all/settings/storage' : null,
  });

  async function open(c: WizardContext) {
    render(
      <MemoryRouter>
        <DialogHost />
      </MemoryRouter>
    );
    act(() => {
      runClassWizard(c, { cephPools: [] }, () => undefined);
    });
    // The wizard just opened: the last dialog of the host (dialogs of earlier tests stay open).
    const dialogs = await screen.findAllByRole('dialog');
    const w = within(dialogs[dialogs.length - 1]);
    return { w, card: w.getByText('Shared filesystem').closest('button') as HTMLButtonElement };
  }

  it('on k4all without the Driver: disabled, says to turn CephFS on in the k4all addon, with the link', async () => {
    const { w, card } = await open(fsCtx(true));
    expect(card.disabled).toBe(true);
    expect(w.getByText(K4ALL_CEPHFS_OFF)).toBeTruthy();
    expect(w.getByText('Open the k4all addon').getAttribute('href')).toBe('/c/main/k4all/settings/storage');
    fireEvent.click(w.getByText('Cancel'));
  });

  it('elsewhere, the class of the driver is enough, as before', async () => {
    const { w, card } = await open(fsCtx(false));
    expect(card.disabled).toBe(false);
    expect(w.queryByText(K4ALL_CEPHFS_OFF)).toBeNull();
    expect(w.queryByText('Open the k4all addon')).toBeNull();
    fireEvent.click(w.getByText('Cancel'));
  });
});
