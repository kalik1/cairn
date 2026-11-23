/*
 * Capacity: raw space with Ceph's near-full, backfill-full and full
 * ratios marked on the meter, raw space per device class, and what each
 * pool can still take after replication or erasure coding.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { bytes, count, pct } from '../../model/format';
import { ratiosOf } from '../../model/osd';
import { Pool } from '../../model/types';
import { Column, DataTable } from '../../ui/DataTable';
import { Meter, MiniBar, Mono, Panel } from '../../ui/kit';
import { STATE, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { Hint, ViewLink } from './common';

/** A meter with marks at the ratios (0..1) and at the fullest OSD. */
export function RatioMeter({
  used,
  total,
  marks,
  peak,
  label,
}: {
  used: number;
  total: number;
  marks: { at: number; label: string }[];
  peak?: { at: number; label: string };
  label: string;
}) {
  const t = useTokens();
  const p = total > 0 ? Math.min(1, used / total) : 0;
  const nearest = marks.length ? Math.min(...marks.map(m => m.at)) : 1;
  const color = p >= nearest ? STATE.err : p >= 0.75 ? STATE.warn : t.meterUsed;
  return (
    <Box sx={{ position: 'relative', pb: 2.25, pt: peak ? 2.25 : 0 }}>
      <Box
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p * 100)}
        sx={{ position: 'relative', height: 14, borderRadius: 1, background: t.meterTrack, overflow: 'visible' }}
      >
        <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p * 100}%`, background: color, borderRadius: 1 }} />
        {marks.map(m => (
          <Box key={m.label} aria-hidden sx={{ position: 'absolute', left: `${m.at * 100}%`, top: -3, bottom: -3, width: '1.5px', background: t.text, opacity: 0.55 }} />
        ))}
        {peak && (
          <Box
            aria-hidden
            title={peak.label}
            sx={{
              position: 'absolute',
              left: `calc(${Math.min(1, peak.at) * 100}% - 5px)`,
              top: -9,
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: `7px solid ${t.text}`,
            }}
          />
        )}
      </Box>
      {peak && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            ...(peak.at > 0.7 ? { right: `calc(${(1 - Math.min(1, peak.at)) * 100}% + 9px)` } : { left: `calc(${Math.min(1, peak.at) * 100}% + 9px)` }),
            fontSize: 11.5,
            color: t.muted,
            whiteSpace: 'nowrap',
            lineHeight: '16px',
            ...tabular,
          }}
        >
          {peak.label}
        </Box>
      )}
      {marks.map(m => (
        <Box
          key={m.label}
          sx={{
            position: 'absolute',
            left: `${m.at * 100}%`,
            top: (peak ? 18 : 0) + 19,
            transform: 'translateX(-50%)',
            fontSize: 11,
            color: t.muted,
            whiteSpace: 'nowrap',
            lineHeight: 1,
            ...tabular,
          }}
        >
          {Math.round(m.at * 100)}%
        </Box>
      ))}
    </Box>
  );
}

export function Capacity() {
  const t = useTokens();
  const { core } = useCeph();
  const df = core.df;
  const s = core.status;
  const r = ratiosOf(core.osdMap);
  const total = df?.total ?? s?.totalBytes ?? 0;
  const usedRaw = df?.usedRaw ?? s?.usedBytes ?? 0;
  const avail = df?.avail ?? s?.availBytes ?? 0;
  const fullest = [...core.osds].sort((a, b) => b.utilization - a.utilization)[0];
  const classes = Object.entries(df?.byClass ?? {});
  const marks = [
    { at: r.nearFull, label: `near full ${Math.round(r.nearFull * 100)}%` },
    { at: r.backfillFull, label: `backfill full ${Math.round(r.backfillFull * 100)}%` },
    { at: r.full, label: `full ${Math.round(r.full * 100)}%` },
  ];
  const pools = core.pools.filter(p => p.usage);
  const rawSum = pools.reduce((n, p) => n + (p.usage?.used ?? 0), 0) || 1;
  const cols: Column<Pool>[] = [
    {
      id: 'name',
      header: 'Pool',
      cell: p => (
        <ViewLink view="pools" a={p.name}>
          {p.name}
        </ViewLink>
      ),
      sort: p => p.name,
    },
    {
      id: 'kind',
      header: 'Protection',
      cell: p => (p.type === 'erasure' && p.ec ? `EC ${p.ec.k}+${p.ec.m}` : `${p.size} copies`),
      sort: p => p.rawFactor,
      minWidth: 640,
    },
    { id: 'stored', header: 'Stored', cell: p => bytes(p.usage?.stored), sort: p => p.usage?.stored ?? 0, align: 'right' },
    {
      id: 'raw',
      header: 'Raw used',
      cell: p => <span title={`${p.rawFactor.toFixed(2)} raw bytes per stored byte`}>{bytes(p.usage?.used)}</span>,
      sort: p => p.usage?.used ?? 0,
      align: 'right',
      minWidth: 560,
    },
    { id: 'avail', header: 'Usable space left', cell: p => bytes(p.usage?.maxAvail), sort: p => p.usage?.maxAvail ?? 0, align: 'right' },
    {
      id: 'pct',
      header: 'Used',
      cell: p => (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <MiniBar pct={(p.usage?.percentUsed ?? 0) * 100} width={56} />
          {pct(p.usage?.percentUsed ?? 0)}
        </Box>
      ),
      sort: p => p.usage?.percentUsed ?? 0,
    },
    {
      id: 'share',
      header: 'Share of raw used',
      cell: p => pct((p.usage?.used ?? 0) / rawSum),
      sort: p => p.usage?.used ?? 0,
      align: 'right',
      minWidth: 760,
    },
    { id: 'obj', header: 'Objects', cell: p => count(p.usage?.objects), sort: p => p.usage?.objects ?? 0, align: 'right', minWidth: 860 },
  ];
  return (
    <Panel title="Capacity" icon="mdi:database-outline" id="capacity">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
            <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
              Raw space
            </Typography>
            <Typography sx={{ fontSize: 13, color: t.muted, ...tabular }}>
              {bytes(usedRaw)} used, {bytes(avail)} available, {bytes(total)} in total ({pct(total ? usedRaw / total : 0)})
            </Typography>
          </Box>
          <RatioMeter
            used={usedRaw}
            total={total}
            marks={marks}
            peak={fullest ? { at: fullest.utilization / 100, label: `fullest: ${fullest.name} ${Math.round(fullest.utilization)}%` } : undefined}
            label="Raw space used"
          />
          <Hint>
            Marks at {Math.round(r.nearFull * 100)}% near full (Ceph warns), {Math.round(r.backfillFull * 100)}% backfill full (no data moves
            there) and {Math.round(r.full * 100)}% full (writes stop). They apply to each OSD, so the fullest OSD reaches them first.
          </Hint>
        </Box>
        {classes.length > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 2 }}>
            {classes.map(([cls, v]) => (
              <Meter
                key={cls}
                label={
                  <>
                    Device class <Mono>{cls}</Mono>
                  </>
                }
                used={v.usedRaw}
                total={v.total}
                format={bytes}
                warnAt={75}
                errAt={r.nearFull * 100}
                caption={`${bytes(v.avail)} available, ${pct(v.total ? v.usedRaw / v.total : 0)} used`}
              />
            ))}
          </Box>
        )}
        <Box>
          <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>
            Usable space per pool
          </Typography>
          <Hint sx={{ mb: 0.75 }}>
            Usable space left already accounts for each pool’s copies or erasure-coding overhead and for the fullest OSD its rule uses.
          </Hint>
          <DataTable label="Pool capacity" rows={pools} columns={cols} rowKey={p => String(p.id)} initialSort={{ id: 'raw', dir: 'desc' }} />
        </Box>
      </Box>
    </Panel>
  );
}
