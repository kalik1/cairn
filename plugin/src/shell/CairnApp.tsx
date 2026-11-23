/*
 * The Cairn app: providers (settings, Kubernetes lists, Ceph live state),
 * the top bar and the current view. Fills Headlamp's content area and
 * scrolls inside.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { CephProvider } from '../api/ceph';
import { KubeProvider, useKube } from '../api/kube';
import { DialogHost } from '../ui/dialogs';
import { useTokens } from '../ui/useTokens';
import { ActivityView } from '../views/activity/ActivityView';
import { CephFsView } from '../views/cephfs/CephFsView';
import { ConfigView } from '../views/config/ConfigView';
import { DaemonsView } from '../views/daemons/DaemonsView';
import { KubernetesView } from '../views/kubernetes/KubernetesView';
import { ObjectView } from '../views/object/ObjectView';
import { OsdsView } from '../views/osds/OsdsView';
import { OverviewView } from '../views/overview/OverviewView';
import { PoolsView } from '../views/pools/PoolsView';
import { RbdView } from '../views/rbd/RbdView';
import { SecurityView } from '../views/security/SecurityView';
import { ActivityStrip } from './ActivityStrip';
import { Loading,NoCluster } from './Gate';
import { useNav } from './nav';
import { SettingsProvider } from './settings';
import { TopBar } from './TopBar';

function Main() {
  const nav = useNav();
  const kube = useKube();
  if (!kube.cephClusters.loaded) return <Loading label="Looking for Ceph clusters…" />;
  if (!kube.cephCluster) return <NoCluster />;
  switch (nav.view) {
    case 'osds':
      return <OsdsView osd={nav.a} />;
    case 'daemons':
      return <DaemonsView tab={nav.a} />;
    case 'pools':
      return <PoolsView key={nav.a ?? ''} pool={nav.a} />;
    case 'rbd':
      return <RbdView key={`${nav.a}/${nav.b}/${nav.c}`} pool={nav.a} image={nav.b} ns={nav.c} />;
    case 'cephfs':
      return <CephFsView fs={nav.a} />;
    case 'object':
      return <ObjectView store={nav.a} tab={nav.b} />;
    case 'kubernetes':
      return <KubernetesView tab={nav.a} />;
    case 'security':
      return <SecurityView />;
    case 'config':
      return <ConfigView tab={nav.a} />;
    case 'activity':
      return <ActivityView />;
    default:
      return <OverviewView />;
  }
}

function Layout() {
  const t = useTokens();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 480, background: t.sunken, color: t.text }}>
      <TopBar />
      <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Main />
      </Box>
      <ActivityStrip />
      <DialogHost />
    </Box>
  );
}

export function CairnApp() {
  return (
    <SettingsProvider>
      <KubeProvider>
        <CephProvider>
          <Layout />
        </CephProvider>
      </KubeProvider>
    </SettingsProvider>
  );
}
