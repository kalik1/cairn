/*
 * The overview (/ceph): is the data safe (verdict and placement-group
 * field), what needs attention (Cairn alerts, Ceph's health checks, crash
 * reports), how full and how busy the cluster is, and the daemons in one
 * row. Without Ceph's live state it shows what Rook reports (RookReport).
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { LiveGate } from '../../shell/Gate';
import { Page } from '../../ui/kit';
import { Alerts } from './Alerts';
import { Capacity } from './Capacity';
import { Crashes } from './Crashes';
import { DaemonSummary } from './DaemonSummary';
import { HealthChecks } from './HealthChecks';
import { Performance } from './Performance';
import { RookReport } from './RookReport';
import { VerdictBand } from './VerdictBand';

export function OverviewView() {
  const { phase } = useCeph();
  return (
    <Page title="Overview" subtitle="Whether the data is safe, what needs attention, and how full and busy the cluster is.">
      <LiveGate>
        <VerdictBand />
        <DaemonSummary />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 3fr) minmax(0, 2fr)' }, gap: 2, alignItems: 'start' }}>
          <HealthChecks />
          <Alerts />
        </Box>
        <Capacity />
        <Performance />
        <Crashes />
      </LiveGate>
      {(phase === 'forbidden' || phase === 'unavailable') && <RookReport />}
    </Page>
  );
}
