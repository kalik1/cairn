/*
 * Kubernetes events of the Rook namespace: what the operator, the kubelet
 * and the scheduler said about Ceph's pods and Rook's resources, warnings
 * first. Kubernetes keeps events about an hour.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useKube } from '../../api/kube';
import { EventRow, eventRows, filterEvents, warningReasons } from '../../model/events';
import { Loading } from '../../shell/Gate';
import { Column, DataTable } from '../../ui/DataTable';
import { Empty, Mono, Notice, Panel, Toolbar, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { SearchField, SmallSelect } from '../kubernetes/parts';

export function EventsTab() {
  const kube = useKube();
  const t = useTokens();
  const [type, setType] = React.useState('');
  const [q, setQ] = React.useState('');
  const rows = React.useMemo(() => eventRows(kube.events.items), [kube.events.items]);
  const shown = React.useMemo(() => filterEvents(rows, { type, q }), [rows, type, q]);
  const reasons = warningReasons(rows);
  if (!kube.events.loaded) return <Loading label="Reading events…" />;
  if (kube.events.forbidden)
    return (
      <Notice tone="warn" title="Your role may not list events">
        Cairn needs list on events in {kube.ns} (the cairn-viewer role has it).
      </Notice>
    );

  const cols: Column<EventRow>[] = [
    {
      id: 'type',
      header: 'Type',
      cell: r => <StateLabel tone={r.type === 'Warning' ? 'warn' : 'idle'} size="sm">{r.type}</StateLabel>,
      sort: r => (r.type === 'Warning' ? 0 : 1),
      width: 100,
    },
    { id: 'reason', header: 'Reason', cell: r => r.reason, sort: r => r.reason, width: 170 },
    {
      id: 'obj',
      header: 'Object',
      cell: r => (
        <span title={`${r.objectKind} ${r.objectNs ? `${r.objectNs}/` : ''}${r.objectName}`}>
          <Box component="span" sx={{ color: t.muted, mr: 0.75 }}>
            {r.objectKind}
          </Box>
          <Mono>{r.objectName}</Mono>
        </span>
      ),
      sort: r => `${r.objectKind}/${r.objectName}`,
      width: 360,
    },
    {
      id: 'msg',
      header: 'Message',
      cell: r => (
        <Box component="span" sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          {r.message}
        </Box>
      ),
      width: 620,
    },
    { id: 'count', header: 'Count', cell: r => r.count, sort: r => r.count, align: 'right', width: 70 },
    { id: 'last', header: 'Last seen', cell: r => <When at={r.last} />, sort: r => r.last ?? 0, width: 110 },
    { id: 'src', header: 'From', cell: r => <Mono muted>{r.source || '—'}</Mono>, sort: r => r.source, minWidth: 1400 },
  ];

  return (
    <Panel dense>
      <Toolbar sx={{ gap: 1, py: 1 }}>
        <SmallSelect
          label="Type"
          value={type}
          onChange={setType}
          width={150}
          options={[
            { value: '', label: 'All events' },
            { value: 'Warning', label: 'Warnings' },
            { value: 'Normal', label: 'Normal' },
          ]}
        />
        <SearchField value={q} onChange={setQ} placeholder="Search reasons, objects, messages" width={300} name="events-search" />
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 12.5, color: t.muted, pr: 1 }}>
          {reasons.length
            ? `Warnings: ${reasons
                .slice(0, 4)
                .map(r => `${r.reason} ×${r.count}`)
                .join(', ')}`
            : 'No warnings'}
        </Typography>
      </Toolbar>
      <DataTable
        label={`Events in ${kube.ns}`}
        rows={shown}
        columns={cols}
        rowKey={r => r.key}
        initialSort={{ id: 'type', dir: 'asc' }}
        empty={
          rows.length ? (
            <Empty icon="mdi:filter-off-outline" title="No event matches">
              Clear the search or the type filter.
            </Empty>
          ) : (
            <Empty icon="mdi:calendar-check-outline" title={`No events in ${kube.ns}`}>
              Kubernetes keeps events about an hour: nothing has happened to Rook’s pods and resources lately.
            </Empty>
          )
        }
      />
    </Panel>
  );
}
