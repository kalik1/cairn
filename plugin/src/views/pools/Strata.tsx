/*
 * A geological column: capacity drawn as strata, bottom to top, on the
 * basalt band. Lines across it mark thresholds (quota, near-full). The
 * numbers always sit next to it in words (Legend), so the drawing never
 * carries a value alone.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';

export interface Stratum {
  key: string;
  label: React.ReactNode;
  value: number;
  fill: string;
  texture?: 'solid' | 'hatch' | 'dots';
  /** Shown next to the swatch (bytes, share…). */
  detail?: React.ReactNode;
}

export interface Threshold {
  at: number;
  label: string;
  color: string;
}

export function Column({
  strata,
  total,
  marks = [],
  width = 92,
  height = 220,
  label,
}: {
  strata: Stratum[];
  total: number;
  marks?: Threshold[];
  width?: number;
  height?: number;
  label: string;
}) {
  const t = useTokens();
  const id = React.useId().replace(/:/g, '');
  const labelW = marks.length ? 132 : 0;
  const pad = 6;
  const H = height - pad * 2;
  const vals = strata.map(s => Math.max(0, s.value));
  const sum = Math.max(total, vals.reduce((a, b) => a + b, 0), 1);
  // Every non-empty stratum stays visible (at least 2 px).
  const raw = vals.map(v => (v / sum) * H);
  const small = raw.map(h => (h > 0 && h < 2 ? 2 : h));
  const extra = small.reduce((a, b) => a + b, 0) - raw.reduce((a, b) => a + b, 0);
  const big = small.reduce((a, h) => (h > 2 ? a + h : a), 0);
  const hs = small.map(h => (h > 2 && big > 0 ? h - (extra * h) / big : h));
  let y = pad + H;
  const rects = hs.map((h, i) => {
    y -= h;
    return { y, h, s: strata[i] };
  });
  const yOf = (v: number) => pad + H - (Math.min(v, sum) / sum) * H;
  return (
    <Box component="svg" width={width + labelW} height={height} role="img" aria-label={label} sx={{ display: 'block', flex: 'none', overflow: 'visible' }}>
      <defs>
        {strata.map((s, i) => (
          <pattern key={s.key} id={`${id}-p${i}`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform={s.texture === 'hatch' ? 'rotate(45)' : undefined}>
            {s.texture === 'dots' ? (
              <circle cx={3} cy={3} r={0.9} fill={s.fill} />
            ) : (
              <>
                <rect width={6} height={6} fill={`${s.fill}40`} />
                <rect width={2.2} height={6} fill={s.fill} />
              </>
            )}
          </pattern>
        ))}
        <clipPath id={`${id}-clip`}>
          <rect x={0.5} y={pad} width={width - 1} height={H} rx={5} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect x={0} y={pad} width={width} height={H} fill="rgba(255,255,255,0.04)" />
        {rects.map(
          (r, i) =>
            r.h > 0 && (
              <rect
                key={r.s.key}
                x={0}
                y={r.y}
                width={width}
                height={r.h}
                fill={!r.s.texture || r.s.texture === 'solid' ? r.s.fill : `url(#${id}-p${i})`}
                stroke={t.basalt}
                strokeWidth={r.h > 3 ? 1 : 0}
              >
                <title>{typeof r.s.label === 'string' ? r.s.label : r.s.key}</title>
              </rect>
            )
        )}
      </g>
      <rect x={0.5} y={pad} width={width - 1} height={H} rx={5} fill="none" stroke={t.basaltEdge} strokeWidth={1} />
      {marks.map(m => {
        const my = yOf(m.at);
        return (
          <g key={m.label}>
            <line x1={-4} x2={width + 8} y1={my} y2={my} stroke={m.color} strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={width + 12} y={my + 4} fill={m.color} fontSize={11.5} style={tabular}>
              {m.label}
            </text>
          </g>
        );
      })}
    </Box>
  );
}

/** The words next to a column: swatch, label, numbers; top stratum first. */
export function Legend({ strata, dense }: { strata: Stratum[]; dense?: boolean }) {
  const t = useTokens();
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: dense ? 0.5 : 0.9, minWidth: 0 }}>
      {[...strata].reverse().map(s => (
        <Box component="li" key={s.key} sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0, fontSize: 13.5 }}>
          <Box
            component="span"
            aria-hidden
            sx={{
              width: 11,
              height: 11,
              flex: 'none',
              borderRadius: '3px',
              alignSelf: 'center',
              background:
                s.texture === 'hatch'
                  ? `repeating-linear-gradient(135deg, ${s.fill} 0 2px, ${s.fill}40 2px 5px)`
                  : s.texture === 'dots'
                  ? `radial-gradient(${s.fill} 1px, transparent 1.3px) 0 0/4px 4px`
                  : s.fill,
              border: `1px solid ${t.basaltEdge}`,
            }}
          />
          <Box component="span" sx={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: t.basaltText }}>
            {s.label}
          </Box>
          {s.detail && (
            <Box component="span" sx={{ color: t.basaltMuted, whiteSpace: 'nowrap', ...tabular }}>
              {s.detail}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

/** A figure on the basalt band. */
export function BandFigure({ value, label, sub }: { value: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode }) {
  const t = useTokens();
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2, color: t.basaltText, whiteSpace: 'nowrap', ...tabular }}>{value}</Box>
      <Box sx={{ fontSize: 12.5, color: t.basaltMuted }}>{label}</Box>
      {sub && <Box sx={{ fontSize: 12, color: t.basaltMuted, ...tabular }}>{sub}</Box>}
    </Box>
  );
}
