/*
 * Every Ceph pool: the cluster's raw capacity as a column of pools on
 * the basalt band, then the pools with protection, usage, PGs, rules,
 * live I/O, who manages them and which StorageClasses use them.
 */

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { denied, rookAttrs, useCan } from '../../api/permissions';
import { bytes, count, ops, pct, rate } from '../../model/format';
import { ownerLabel } from '../../model/pools';
import { LiveGate } from '../../shell/Gate';
import { useNav } from '../../shell/nav';
import { Column as Col, DataTable } from '../../ui/DataTable';
import { Action, Band, Empty, Figure, MiniBar, Mono, Page, Panel, Tag } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { PoolRow, RLink, STRATA, usePoolRows } from './common';
import { openPoolForm } from './PoolForm';
import { Column, Legend, Stratum } from './Strata';

export function PoolList() {
  const c = useCeph();
  const k = useKube();
  const nav = useNav();
  const rows = usePoolRows();
  const canCreate = useCan(rookAttrs('create', 'cephblockpools', k.ns));
  const createReason = k.blockPools.missing
    ? 'The CephBlockPool resource is not installed (Rook CRDs missing).'
    : denied(canCreate, 'creating CephBlockPools') ?? (c.phase !== 'ready' ? c.reason || "Waiting for Ceph's live state" : null);
  return (
    <Page
      title="Pools"
      subtitle="Where Ceph keeps data: each pool decides how many copies an object gets, on which disks, and how much it may hold."
      actions={
        <>
          <Action
            icon="mdi:plus"
            variant="contained"
            reason={createReason}
            onClick={() => openPoolForm({ mode: 'create', onCreated: name => nav.go('pools', name) })}
          >
            Create pool
          </Action>
        </>
      }
    >
      <LiveGate>
        <ClusterBand rows={rows} />
        <Panel dense title={`${rows.length} pools`} icon="mdi:database-outline">
          <PoolTable rows={rows} onOpen={r => nav.go('pools', r.pool.name)} />
        </Panel>
      </LiveGate>
    </Page>
  );
}

/* --------------------------------------------------------- the band */

function ClusterBand({ rows }: { rows: PoolRow[] }) {
  const t = useTokens();
  const c = useCeph();
  const df = c.core.df;
  const total = df?.total ?? 0;
  const usedRaw = df?.usedRaw ?? 0;
  const sorted = [...rows].filter(r => (r.pool.usage?.used ?? 0) > 0).sort((a, b) => (b.pool.usage?.used ?? 0) - (a.pool.usage?.used ?? 0));
  const top = sorted.slice(0, 6);
  const rest = sorted.slice(6);
  const poolRaw = sorted.reduce((n, r) => n + (r.pool.usage?.used ?? 0), 0);
  const restRaw = rest.reduce((n, r) => n + (r.pool.usage?.used ?? 0), 0);
  const other = Math.max(0, usedRaw - poolRaw);
  const share = (v: number) => (total ? pct(v / total) : '—');
  const strata: Stratum[] = [
    ...top.map((r, i) => ({
      key: r.pool.name,
      label: <Mono>{r.pool.name}</Mono>,
      value: r.pool.usage?.used ?? 0,
      fill: STRATA[i % STRATA.length],
      detail: `${bytes(r.pool.usage?.used)} raw, ${share(r.pool.usage?.used ?? 0)}`,
    })),
    ...(rest.length
      ? [{ key: '__rest', label: `${rest.length} smaller pools`, value: restRaw, fill: STRATA[6], detail: `${bytes(restRaw)} raw, ${share(restRaw)}` }]
      : []),
    { key: '__other', label: 'OSD overhead (BlueStore, logs)', value: other, fill: '#93A4AE', texture: 'hatch' as const, detail: `${bytes(other)}, ${share(other)}` },
    { key: '__free', label: 'Free', value: df?.avail ?? 0, fill: '#93A4AE', texture: 'dots' as const, detail: `${bytes(df?.avail)}, ${share(df?.avail ?? 0)}` },
  ];
  const near = c.core.osdMap?.nearFullRatio ?? 0.85;
  const full = c.core.osdMap?.fullRatio ?? 0.95;
  const stored = rows.reduce((n, r) => n + (r.pool.usage?.stored ?? 0), 0);
  return (
    <Band>
      <Box sx={{ display: 'grid', gap: { xs: 2, md: 4 }, gridTemplateColumns: { xs: 'auto minmax(0, 1fr)', lg: 'auto minmax(0, 1fr) minmax(240px, 320px)' }, alignItems: 'start' }}>
        <Box sx={{ gridRow: { xs: 'span 2', lg: 'auto' } }}>
          <Column
          strata={strata}
          total={total}
          label={`Cluster raw capacity: ${bytes(usedRaw)} of ${bytes(total)} used`}
          marks={[
            { at: total * near, label: `Near full ${pct(near, 0)}`, color: '#D9A02B' },
            { at: total * full, label: `Full ${pct(full, 0)}`, color: '#E0707A' },
          ]}
          />
        </Box>
        <Box sx={{ maxWidth: 620, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Box sx={{ fontSize: 16, fontWeight: 600, color: t.basaltText }}>Raw capacity by pool</Box>
            <Box sx={{ fontSize: 13, color: t.basaltMuted }}>
              Each layer is the raw space a pool takes on the OSDs, copies and coding chunks included.
            </Box>
          </Box>
          <Legend strata={strata} />
        </Box>
        <Box sx={{ gridColumn: { xs: '2', lg: 'auto' }, maxWidth: 360, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, alignContent: 'start' }}>
          <Figure onBand value={bytes(usedRaw)} label="Raw used" sub={`of ${bytes(total)} (${share(usedRaw)})`} />
          <Figure onBand value={bytes(stored)} label="Data stored" sub="before copies" />
          <Figure onBand value={bytes(df?.avail)} label="Raw free" sub={`full at ${pct(full, 0)}`} />
          <Figure onBand value={rows.length} label="Pools" sub={`${count(rows.reduce((n, r) => n + (r.pool.usage?.objects ?? 0), 0))} objects`} />
        </Box>
      </Box>
    </Band>
  );
}

/* -------------------------------------------------------- the table */

export function PoolTable({ rows, onOpen, activeKey }: { rows: PoolRow[]; onOpen: (r: PoolRow) => void; activeKey?: string }) {
  const t = useTokens();
  const sub = (x: React.ReactNode) => <Box sx={{ fontSize: 12, color: t.muted, ...tabular }}>{x}</Box>;
  const cols: Col<PoolRow>[] = [
    {
      id: 'name',
      header: 'Pool',
      cell: r => (
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Mono>{r.pool.name}</Mono>
          {sub(<StateLabel tone={r.state.tone} size="sm">{r.state.word}</StateLabel>)}
        </Box>
      ),
      sort: r => r.pool.name,
      width: 220,
    },
    {
      id: 'type',
      header: 'Protection',
      cell: r => (
        <Box>
          {r.pool.type === 'erasure' ? `EC ${r.pool.ec ? `${r.pool.ec.k}+${r.pool.ec.m}` : ''}` : `${r.pool.size} copies`}
          {sub(r.pool.type === 'erasure' ? `profile ${r.pool.ecProfile}` : `min ${r.pool.minSize}`)}
        </Box>
      ),
      sort: r => r.pool.rawFactor,
    },
    {
      id: 'apps',
      header: 'Application',
      cell: r =>
        r.pool.applications.length ? (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {r.pool.applications.map(a => (
              <Tag key={a}>{a}</Tag>
            ))}
          </Box>
        ) : (
          '—'
        ),
      sort: r => r.pool.applications.join(','),
      minWidth: 1500,
    },
    { id: 'stored', header: 'Stored', cell: r => bytes(r.pool.usage?.stored), sort: r => r.pool.usage?.stored ?? 0, align: 'right' },
    { id: 'raw', header: 'Raw used', cell: r => bytes(r.pool.usage?.used), sort: r => r.pool.usage?.used ?? 0, align: 'right', minWidth: 1100 },
    {
      id: 'pct',
      header: 'Used',
      cell: r => (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <MiniBar pct={(r.pool.usage?.percentUsed ?? 0) * 100} width={56} />
          <span>{pct(r.pool.usage?.percentUsed)}</span>
        </Box>
      ),
      sort: r => r.pool.usage?.percentUsed ?? 0,
    },
    { id: 'avail', header: 'Max available', cell: r => bytes(r.pool.usage?.maxAvail), sort: r => r.pool.usage?.maxAvail ?? 0, align: 'right' },
    { id: 'objects', header: 'Objects', cell: r => count(r.pool.usage?.objects), sort: r => r.pool.usage?.objects ?? 0, align: 'right', minWidth: 1400 },
    {
      id: 'pgs',
      header: 'PGs',
      cell: r => {
        const a = r.autoscale;
        const moving = r.pool.pgNumTarget !== r.pool.pgNum;
        return (
          <Tooltip
            title={`pg_num ${r.pool.pgNum}, target ${r.pool.pgNumTarget}${a ? `, autoscaler ideal ${a.pgNumIdeal}, would set ${a.pgNumFinal}` : ''}`}
          >
            <Box component="span">
              {r.pool.pgNum}
              {moving ? ` → ${r.pool.pgNumTarget}` : ''}
              {sub(a ? `ideal ${a.pgNumIdeal}` : '')}
            </Box>
          </Tooltip>
        );
      },
      sort: r => r.pool.pgNum,
      align: 'right',
    },
    {
      id: 'auto',
      header: 'Autoscale',
      cell: r => (
        <Box>
          {r.pool.autoscaleMode}
          {r.autoscale?.wouldAdjust ? sub('would adjust') : null}
        </Box>
      ),
      sort: r => r.pool.autoscaleMode,
      minWidth: 1500,
    },
    { id: 'comp', header: 'Compression', cell: r => r.pool.compressionMode, sort: r => r.pool.compressionMode, minWidth: 1550 },
    {
      id: 'quota',
      header: 'Quota',
      cell: r =>
        r.pool.quotaBytes || r.pool.quotaObjects ? (
          <Box>
            {r.pool.quotaBytes ? bytes(r.pool.quotaBytes) : '—'}
            {sub(r.pool.quotaObjects ? `${count(r.pool.quotaObjects)} objects` : '')}
          </Box>
        ) : (
          '—'
        ),
      sort: r => r.pool.quotaBytes,
      minWidth: 1350,
    },
    {
      id: 'rule',
      header: 'CRUSH rule',
      cell: r => (
        <Box>
          <Mono>{r.pool.crushRule}</Mono>
          {sub(r.rule ? `${r.rule.failureDomain}${r.rule.deviceClass ? `, ${r.rule.deviceClass}` : ', any class'}` : '')}
        </Box>
      ),
      sort: r => r.pool.crushRule,
      minWidth: 1300,
    },
    {
      id: 'read',
      header: 'Read',
      cell: r => (
        <Box>
          {rate(r.pool.io?.readBps ?? 0)}
          {sub(ops(r.pool.io?.readOps ?? 0))}
        </Box>
      ),
      sort: r => r.pool.io?.readBps ?? 0,
      align: 'right',
    },
    {
      id: 'write',
      header: 'Write',
      cell: r => (
        <Box>
          {rate(r.pool.io?.writeBps ?? 0)}
          {sub(ops(r.pool.io?.writeOps ?? 0))}
        </Box>
      ),
      sort: r => r.pool.io?.writeBps ?? 0,
      align: 'right',
    },
    {
      id: 'owner',
      header: 'Managed by',
      cell: r => (
        <Box component="span" title={r.owner.about} sx={{ color: r.owner.kind === 'unmanaged' ? t.muted : undefined }}>
          {ownerLabel(r.owner)}
          {r.owner.role ? sub(r.owner.role) : null}
        </Box>
      ),
      sort: r => ownerLabel(r.owner),
      width: 200,
    },
    {
      id: 'sc',
      header: 'StorageClasses',
      cell: r =>
        r.scs.length ? (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {r.scs.map(u => (
              <Box key={u.sc.metadata.name} component="span">
                <Mono>{u.sc.metadata.name}</Mono>
                {u.via !== 'pool' && <Box component="span" sx={{ color: t.muted, fontSize: 12 }}> ({u.via})</Box>}
              </Box>
            ))}
          </Box>
        ) : (
          <Box component="span" sx={{ color: t.muted }}>
            None
          </Box>
        ),
      sort: r => r.scs.map(u => u.sc.metadata.name).join(','),
      width: 200,
      minWidth: 1050,
    },
  ];
  return (
    <DataTable
      label="Pools"
      rows={rows}
      columns={cols}
      rowKey={r => r.pool.name}
      onOpen={onOpen}
      activeKey={activeKey}
      initialSort={{ id: 'name', dir: 'asc' }}
      empty={
        <Empty icon="mdi:database-plus-outline" title="No pools yet">
          Create a pool for block volumes: it gets a CephBlockPool, and Rook creates it in Ceph.
        </Empty>
      }
    />
  );
}

export function PoolLink({ name }: { name: string }) {
  const nav = useNav();
  return (
    <RLink to={nav.href('pools', name)}>
      <Mono>{name}</Mono>
    </RLink>
  );
}
