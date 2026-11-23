/*
 * Activity: every operation started from Cairn in this browser, with its
 * outcome. The cluster's own record is the Ceph audit log and the
 * Kubernetes audit log (each Ceph batch is an exec under your user).
 */

import Box from '@mui/material/Box';
import React from 'react';
import { activity, useActivity } from '../../api/activity';
import { Op } from '../../api/activity';
import { Column, DataTable } from '../../ui/DataTable';
import { Empty, Mono, Page, Panel, ToolButton } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';

const tone = (o: Op) => (o.status === 'done' ? 'ok' : o.status === 'failed' ? 'err' : 'move');
const word = (o: Op) => (o.status === 'done' ? 'Done' : o.status === 'failed' ? 'Failed' : 'Running');

export function ActivityView() {
  const ops = useActivity();
  const cols: Column<Op>[] = [
    { id: 'when', header: 'Started', cell: o => new Date(o.started).toLocaleString(), sort: o => o.started, width: 180 },
    { id: 'what', header: 'Operation', cell: o => o.title, sort: o => o.title, width: 320 },
    { id: 'target', header: 'On', cell: o => (o.target ? <Mono>{o.target}</Mono> : '—'), sort: o => o.target ?? '', minWidth: 900 },
    { id: 'state', header: 'Outcome', cell: o => <StateLabel tone={tone(o)}>{word(o)}</StateLabel>, sort: o => o.status, width: 110 },
    {
      id: 'msg',
      header: 'Answer',
      cell: o => (
        <Box component="span" title={o.detail ? `${o.detail}\n\n${o.message ?? ''}` : o.message} sx={{ whiteSpace: 'normal' }}>
          {o.message ?? '—'}
        </Box>
      ),
      width: 480,
    },
  ];
  return (
    <Page
      title="Activity"
      subtitle="Operations started from Cairn in this browser, newest first. Ceph keeps its own audit log (Configuration → Logs), and every Ceph command batch is an exec recorded by the Kubernetes audit log under your user."
      actions={
        <ToolButton icon="mdi:broom" onClick={() => activity.clear()} disabled={!ops.length}>
          Clear finished
        </ToolButton>
      }
    >
      <Panel dense>
        <DataTable
          label="Operations"
          rows={ops}
          columns={cols}
          rowKey={o => o.id}
          initialSort={{ id: 'when', dir: 'desc' }}
          empty={<Empty icon="mdi:history" title="Nothing yet">Operations you start (flags, OSD changes, pools, snapshots…) appear here with Ceph's answer.</Empty>}
        />
      </Panel>
    </Page>
  );
}
