/*
 * Kubernetes: how Kubernetes uses this Ceph cluster. Three tabs, each a
 * stable URL (/ceph/kubernetes/<tab>): the storage classes (and the wizard
 * that makes them), the volumes they made, and the Ceph-CSI drivers that
 * mount them. Everything here is Kubernetes data: it renders without the
 * permission to run Ceph commands.
 */

import React from 'react';
import { useKube } from '../../api/kube';
import { cephKindOf } from '../../model/storageclass';
import { Page } from '../../ui/kit';
import { ClassesTab } from './ClassesTab';
import { CsiTab } from './CsiTab';
import { SubTab, SubTabs } from './parts';
import { VolumesTab } from './VolumesTab';

const TABS = ['classes', 'volumes', 'csi'] as const;
type Tab = (typeof TABS)[number];

export function KubernetesView({ tab }: { tab?: string }) {
  const kube = useKube();
  const current: Tab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'classes';
  const cephClasses = kube.storageClasses.items.filter(s => cephKindOf(s.provisioner)).length;
  const cephPvs = kube.pvs.items.filter(p => cephKindOf(p.spec?.csi?.driver)).length;
  const tabs: SubTab[] = [
    { id: 'classes', label: 'Storage classes', badge: kube.storageClasses.loaded ? cephClasses : undefined },
    { id: 'volumes', label: 'Volumes', badge: kube.pvs.loaded ? cephPvs : undefined },
    { id: 'csi', label: 'CSI drivers' },
  ];
  return (
    <Page title="Kubernetes" subtitle="How Kubernetes uses this Ceph cluster: the storage classes, the volumes they made and who mounts them, and the CSI drivers that do it.">
      <SubTabs view="kubernetes" tabs={tabs} current={current} label="Kubernetes sections" />
      {current === 'classes' && <ClassesTab />}
      {current === 'volumes' && <VolumesTab />}
      {current === 'csi' && <CsiTab />}
    </Page>
  );
}
