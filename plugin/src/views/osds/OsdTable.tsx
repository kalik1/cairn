/*
 * Every OSD in one table, by host: size and fill, placement groups,
 * up/in, weights, latency, the device behind it and its pod. Select rows
 * for bulk operations; a row opens the OSD.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { bytes, ms } from '../../model/format';
import { backing, fillTone, ratiosOf } from '../../model/osd';
import { Osd } from '../../model/types';
import { useNav } from '../../shell/nav';
import { Column, DataTable } from '../../ui/DataTable';
import { Divider, Empty, MiniBar, Mono, Notice, Panel, Tag, Toolbar,ToolButton } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { Hint, PodLink, useCephReason } from '../overview/common';
import { markIn, markOut, openMaintenance, scrub, setNoout } from './ops';

export function OsdTable() {
  const t = useTokens();
  const c = useCeph();
  const nav = useNav();
  const reason = useCephReason();
  const r = ratiosOf(c.core.osdMap);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [err, setErr] = React.useState<string | null>(null);
  const osds = c.core.osds;
  const chosen = osds.filter(o => sel.has(String(o.id)));
  const run = async (f: () => Promise<void>) => {
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const cols: Column<Osd>[] = [
    { id: 'id', header: 'OSD', cell: o => <Mono>{o.name}</Mono>, sort: o => o.id, width: 70 },
    {
      id: 'host',
      header: 'Host',
      cell: o => (
        <Box component="span" title={o.meta?.hostname ? `Node ${o.meta.hostname}` : undefined}>
          {o.meta?.hostname || o.host || '—'}
        </Box>
      ),
      sort: o => `${o.meta?.hostname || o.host}|${String(o.id).padStart(6, '0')}`,
      width: 240,
    },
    { id: 'class', header: 'Class', cell: o => o.deviceClass || '—', sort: o => o.deviceClass, minWidth: 700 },
    { id: 'size', header: 'Size', cell: o => bytes(o.sizeBytes), sort: o => o.sizeBytes, align: 'right' },
    {
      id: 'used',
      header: 'Used',
      cell: o => (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <MiniBar pct={o.utilization} width={52} warnAt={75} errAt={r.nearFull * 100} />
          <Box component="span" sx={{ color: fillTone(o.utilization, r) === 'ok' ? undefined : t.text, fontWeight: fillTone(o.utilization, r) === 'ok' ? 400 : 600 }}>
            {Math.round(o.utilization)}%
          </Box>
        </Box>
      ),
      sort: o => o.utilization,
    },
    { id: 'pgs', header: 'PGs', cell: o => o.pgs, sort: o => o.pgs, align: 'right' },
    { id: 'up', header: 'Up', cell: o => <StateLabel tone={o.up ? 'ok' : 'err'}>{o.up ? 'Up' : 'Down'}</StateLabel>, sort: o => (o.up ? 1 : 0) },
    { id: 'in', header: 'In', cell: o => <StateLabel tone={o.in ? 'ok' : 'warn'}>{o.in ? 'In' : 'Out'}</StateLabel>, sort: o => (o.in ? 1 : 0) },
    { id: 'rw', header: 'Reweight', cell: o => o.reweight.toFixed(2), sort: o => o.reweight, align: 'right', minWidth: 980 },
    { id: 'cw', header: 'CRUSH weight', cell: o => o.crushWeight.toFixed(3), sort: o => o.crushWeight, align: 'right', minWidth: 1080 },
    {
      id: 'lat',
      header: 'Commit / apply',
      cell: o => (o.commitMs === undefined ? '—' : `${ms(o.commitMs)} / ${ms(o.applyMs)}`),
      sort: o => o.commitMs ?? -1,
      align: 'right',
      minWidth: 820,
    },
    { id: 'var', header: 'Variance', cell: o => o.variance.toFixed(2), sort: o => o.variance, align: 'right', minWidth: 1220 },
    {
      id: 'dev',
      header: 'Device',
      cell: o => {
        const b = backing(o);
        return b.device ? (
          <span title={[b.path, b.deviceId].filter(Boolean).join('\n')}>
            <Mono>{b.device}</Mono>
            {b.rotational !== null && (
              <Box component="span" sx={{ color: t.muted }}>
                {b.rotational ? ' HDD' : ' SSD'}
              </Box>
            )}
          </span>
        ) : (
          '—'
        );
      },
      sort: o => backing(o).device,
      minWidth: 900,
    },
    {
      id: 'flags',
      header: 'Flags',
      cell: o =>
        o.flags.length ? (
          <Box component="span" sx={{ display: 'inline-flex', gap: 0.5 }}>
            {o.flags.map(f => (
              <Tag key={f} tone="warn">
                {f}
              </Tag>
            ))}
          </Box>
        ) : (
          ''
        ),
      minWidth: osds.some(o => o.flags.length) ? 1000 : 99999,
    },
    { id: 'pod', header: 'Pod', cell: o => <PodLink namespace={o.meta?.podNamespace} name={o.meta?.podName} />, sort: o => o.meta?.podName ?? '', minWidth: 1450 },
  ];
  const off = reason ?? (chosen.length ? null : 'Select OSDs first');
  return (
    <Panel title="OSDs" icon="mdi:harddisk" dense id="osds">
      <Toolbar>
        <Hint sx={{ px: 1 }}>{chosen.length ? `${chosen.length} selected` : 'Select OSDs for bulk operations'}</Hint>
        <Divider />
        <ToolButton icon="mdi:shield-check-outline" disabled={!!off} tooltip={off ?? undefined} onClick={() => run(async () => openMaintenance(c.ns, { osds: chosen }, c.refresh))}>
          Maintenance…
        </ToolButton>
        <ToolButton icon="mdi:pause-circle-outline" disabled={!!off} tooltip={off ?? undefined} onClick={() => run(() => setNoout(c.ns, chosen, true, c.refresh))}>
          Set noout
        </ToolButton>
        <ToolButton icon="mdi:play-circle-outline" disabled={!!off} tooltip={off ?? undefined} onClick={() => run(() => setNoout(c.ns, chosen, false, c.refresh))}>
          Clear noout
        </ToolButton>
        <ToolButton icon="mdi:magnify-scan" disabled={!!off} tooltip={off ?? undefined} onClick={() => run(() => scrub(c.ns, chosen, false, c.refresh))}>
          Scrub
        </ToolButton>
        <ToolButton icon="mdi:layers-search-outline" disabled={!!off} tooltip={off ?? undefined} onClick={() => run(() => scrub(c.ns, chosen, true, c.refresh))}>
          Deep scrub
        </ToolButton>
        <Divider />
        <ToolButton icon="mdi:logout-variant" disabled={!!off} tooltip={off ?? undefined} onClick={() => run(() => markOut(c.ns, chosen, c.refresh))}>
          Mark out
        </ToolButton>
        <ToolButton icon="mdi:login-variant" disabled={!!off} tooltip={off ?? undefined} onClick={() => run(() => markIn(c.ns, chosen, c.refresh))}>
          Mark in
        </ToolButton>
      </Toolbar>
      {err && (
        <Notice tone="err" title="The operation failed" sx={{ m: 1.5 }}>
          {err}
        </Notice>
      )}
      <DataTable
        label="OSDs"
        rows={osds}
        columns={cols}
        rowKey={o => String(o.id)}
        selectable
        selected={sel}
        onSelectedChange={setSel}
        onOpen={o => nav.go('osds', String(o.id))}
        initialSort={{ id: 'host', dir: 'asc' }}
        empty={<Empty icon="mdi:harddisk-plus" title="No OSDs">Add a disk or node to the CephCluster storage to create the first OSDs.</Empty>}
      />
    </Panel>
  );
}
