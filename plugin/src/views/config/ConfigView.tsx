/*
 * Configuration: Ceph's central settings, its cluster and audit logs, the
 * Kubernetes events of the Rook namespace, and Cairn's own settings. Each
 * tab is a stable URL (/ceph/config/<tab>). Ceph parts need the permission
 * to run Ceph commands; events and Cairn's settings do not.
 */

import React from 'react';
import { useKube } from '../../api/kube';
import { Page } from '../../ui/kit';
import { SubTab, SubTabs } from '../kubernetes/parts';
import { CairnTab } from './CairnTab';
import { EventsTab } from './EventsTab';
import { LogTab } from './LogTab';
import { SettingsTab } from './SettingsTab';

const TABS = ['settings', 'log', 'audit', 'events', 'cairn'] as const;
type Tab = (typeof TABS)[number];

export function ConfigView({ tab }: { tab?: string }) {
  const kube = useKube();
  const current: Tab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'settings';
  const warnings = kube.events.items.filter(e => e.type === 'Warning').length;
  const tabs: SubTab[] = [
    { id: 'settings', label: 'Ceph settings' },
    { id: 'log', label: 'Cluster log' },
    { id: 'audit', label: 'Audit log' },
    { id: 'events', label: 'Events', badge: warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : undefined },
    { id: 'cairn', label: 'Cairn' },
  ];
  const subtitle: Record<Tab, string> = {
    settings: 'Ceph’s central configuration: the options set for daemons and clients, what each does, and the recent changes.',
    log: 'What Ceph’s monitors recorded about the cluster: health changes, daemons going up and down, recovery.',
    audit: 'Who ran which Ceph command: every command the monitors received, with the entity that sent it.',
    events: `What Kubernetes recorded about Rook’s pods and resources in ${kube.ns}: scheduling, restarts, the operator’s reconciles.`,
    cairn: 'How Cairn runs (in this browser) and what your role lets you do.',
  };
  return (
    <Page title="Configuration" subtitle={subtitle[current]}>
      <SubTabs view="config" tabs={tabs} current={current} label="Configuration sections" />
      {current === 'settings' && <SettingsTab />}
      {current === 'log' && <LogTab key="cluster" channel="cluster" />}
      {current === 'audit' && <LogTab key="audit" channel="audit" />}
      {current === 'events' && <EventsTab />}
      {current === 'cairn' && <CairnTab />}
    </Page>
  );
}
