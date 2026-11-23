import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { WizardContext } from '../../model/storageclass';
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
