import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Obj } from '../../model/types';
import { ImageSet } from './CsiTab';

vi.mock('../../api/kube', () => ({ useKube: () => ({}) }));
vi.mock('../../api/k8sOps', () => ({ itemsOf: () => [], useKGets: () => ({}) }));
vi.mock('../../api/k4all', () => ({ useK4all: () => true }));
vi.mock('../daemons/counts', () => ({ k4allAddonUrl: (page: string) => `/c/main/k4all/settings/${page}` }));

const MARK = 'Chosen by k4all (CSI image variant): the cephcsi build for the nodes’ CPUs.';

/** A ceph-csi Driver as k4all v2.7.2's ceph-csi-drivers values render it (`imageSet`: drivers.rbd.imageSet). */
const driver = (imageSet?: string): Obj => ({
  apiVersion: 'csi.ceph.io/v1',
  kind: 'Driver',
  metadata: { name: 'rook-ceph.rbd.csi.ceph.com', namespace: 'rook-ceph' },
  spec: { fsGroupPolicy: 'File', ...(imageSet ? { imageSet: { name: imageSet } } : {}) },
});

function show(d: Obj, k4all: boolean, defaultImageSet?: string) {
  return render(
    <MemoryRouter>
      <ImageSet driver={d} k4all={k4all} defaultImageSet={defaultImageSet} />
    </MemoryRouter>
  );
}

describe('the image set of a Driver on the CSI tab', () => {
  it('names k4all’s CSI image variant, with the addon’s storage page', () => {
    show(driver('k4all-cephcsi-v3.18.2-rocky9'), true, 'rook-csi-operator-image-set-configmap');
    expect(screen.getByText('k4all-cephcsi-v3.18.2-rocky9')).toBeTruthy();
    expect(screen.getByText(MARK, { exact: false })).toBeTruthy();
    expect(screen.getByText('Open the k4all addon').getAttribute('href')).toBe('/c/main/k4all/settings/storage');
  });

  it('shows another set without the mark, and k4all’s name without it off k4all', () => {
    show(driver('my-cephcsi-images'), true);
    expect(screen.getByText('my-cephcsi-images')).toBeTruthy();
    expect(screen.queryByText(MARK, { exact: false })).toBeNull();
    show(driver('k4all-cephcsi-v3.18.2-rocky9'), false);
    expect(screen.getByText('k4all-cephcsi-v3.18.2-rocky9')).toBeTruthy();
    expect(screen.queryByText(MARK, { exact: false })).toBeNull();
  });

  it('falls back to the OperatorConfig’s set without spec.imageSet', () => {
    show(driver(), true, 'rook-csi-operator-image-set-configmap');
    expect(screen.getByText('rook-csi-operator-image-set-configmap')).toBeTruthy();
    expect(screen.queryByText(MARK, { exact: false })).toBeNull();
    show(driver(), true);
    expect(screen.getByText('Built in')).toBeTruthy();
  });
});
