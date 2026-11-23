/*
 * Time charts over the live series (src/model/history.ts): client
 * throughput, IOPS, recovery, latency. History starts when Cairn opens
 * and lasts an hour; the charts say so instead of faking a longer past.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCeph } from '../api/ceph';
import { tabular } from './tokens';
import { useTokens } from './useTokens';

export interface ChartSeries {
  name: string;
  /** Series key in the store ("io.readBps", "pool.1.writeOps"…). */
  key: string;
  color: string;
}

/** Re-renders on every new sample. */
export function useSeriesVersion(): number {
  const { series } = useCeph();
  return React.useSyncExternalStore(series.subscribe, series.getVersion);
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function TimeChart({
  series,
  format,
  height = 150,
  minutes = 30,
  kind = 'area',
  title,
  latest,
}: {
  series: ChartSeries[];
  format: (n: number) => string;
  height?: number;
  minutes?: number;
  kind?: 'area' | 'line';
  title?: React.ReactNode;
  /** Show the latest values next to the title. */
  latest?: boolean;
}) {
  const t = useTokens();
  const { series: store } = useCeph();
  useSeriesVersion();
  const keys = Object.fromEntries(series.map(s => [s.name, s.key]));
  const rows = store.table(keys, Date.now() - minutes * 60000);
  const last = rows[rows.length - 1];
  const empty = rows.length < 2;
  const Chart: any = kind === 'line' ? LineChart : AreaChart;
  return (
    <Box sx={{ minWidth: 0 }}>
      {(title || latest) && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 0.5, flexWrap: 'wrap' }}>
          {title && <Typography sx={{ fontSize: 13.5, fontWeight: 600, flex: '1 0 auto', whiteSpace: 'nowrap' }}>{title}</Typography>}
          {latest &&
            last &&
            series.map(s => (
              <Box key={s.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 12.5, color: t.muted, ...tabular }}>
                <Box component="span" sx={{ width: 8, height: 8, borderRadius: '2px', background: s.color }} />
                {s.name} {last[s.name] !== undefined ? format(last[s.name]) : '—'}
              </Box>
            ))}
        </Box>
      )}
      {empty ? (
        <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.muted, fontSize: 13, border: `1px dashed ${t.rule}`, borderRadius: 1 }}>
          Collecting samples: the chart starts when Cairn opens.
        </Box>
      ) : (
        <Box sx={{ height }} role="img" aria-label={typeof title === 'string' ? `${title} chart` : 'Chart'}>
          <ResponsiveContainer width="100%" height="100%">
            <Chart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={t.rule} strokeDasharray="0" />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={hhmm} stroke={t.muted} fontSize={11} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tickFormatter={(v: number) => format(v)} stroke={t.muted} fontSize={11} tickLine={false} axisLine={false} width={72} />
              <Tooltip
                isAnimationActive={false}
                contentStyle={{ background: t.surface, border: `1px solid ${t.rule}`, fontSize: 12.5, borderRadius: 4 }}
                labelFormatter={(v: number) => new Date(v).toLocaleTimeString()}
                formatter={(v: number, name: string) => [format(v), name]}
              />
              {series.map(s =>
                kind === 'line' ? (
                  <Line key={s.key} type="monotone" dataKey={s.name} stroke={s.color} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
                ) : (
                  <Area key={s.key} type="monotone" dataKey={s.name} stroke={s.color} fill={s.color} fillOpacity={0.16} strokeWidth={1.6} isAnimationActive={false} connectNulls />
                )
              )}
            </Chart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  );
}
