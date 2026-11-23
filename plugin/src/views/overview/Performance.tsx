/*
 * Performance over the last half hour (since Cairn opened): client
 * throughput and IOPS, recovery, OSD commit latency.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { ms, ops, rate } from '../../model/format';
import { TimeChart } from '../../ui/charts';
import { Grid, Panel } from '../../ui/kit';
import { SERIES } from '../../ui/tokens';
import { Hint } from './common';

export function Performance() {
  return (
    <Panel
      title="Performance"
      icon="mdi:chart-line"
      id="performance"
      actions={<Hint>Last 30 minutes, since Cairn opened</Hint>}
    >
      <Grid min={300} gap={2.5}>
        <Chart title="Client throughput">
          <TimeChart
            latest
            format={rate}
            series={[
              { name: 'Read', key: 'io.readBps', color: SERIES.read },
              { name: 'Write', key: 'io.writeBps', color: SERIES.write },
            ]}
          />
        </Chart>
        <Chart title="Client IOPS">
          <TimeChart
            latest
            format={ops}
            series={[
              { name: 'Read', key: 'io.readOps', color: SERIES.read },
              { name: 'Write', key: 'io.writeOps', color: SERIES.write },
            ]}
          />
        </Chart>
        <Chart title="Recovery">
          <TimeChart
            latest
            format={rate}
            series={[{ name: 'Recovery', key: 'recovery.bps', color: SERIES.recovery }]}
          />
        </Chart>
        <Chart title="OSD commit latency">
          <TimeChart
            latest
            kind="line"
            format={ms}
            series={[
              { name: 'Average', key: 'lat.avgCommitMs', color: SERIES.latency },
              { name: 'Slowest OSD', key: 'lat.maxCommitMs', color: SERIES.other },
            ]}
          />
        </Chart>
      </Grid>
    </Panel>
  );
}

function Chart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="h3" sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.25 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
