/*
 * Cairn: a Ceph storage console for Rook clusters, as a Headlamp plugin.
 * Registrations only; the app lives in src/shell and src/views.
 */

import { registerAppBarAction, registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { registerIcons } from './icons';
import { CairnApp } from './shell/CairnApp';
import { HealthBadge } from './shell/HealthBadge';
import { ROUTE_NAME, ROUTE_PATH } from './shell/nav';

registerIcons();

registerSidebarEntry({
  parent: null,
  name: 'cairn',
  label: 'Cairn',
  url: '/ceph',
  icon: 'mdi:database-cog-outline',
});

// One route for the whole app, so the live state and chart history survive
// moving between views (src/shell/nav.ts lists the stable URLs).
registerRoute({
  path: ROUTE_PATH,
  exact: false,
  name: ROUTE_NAME,
  sidebar: 'cairn',
  isFullWidth: true,
  component: () => <CairnApp />,
});

registerAppBarAction(<HealthBadge />);
