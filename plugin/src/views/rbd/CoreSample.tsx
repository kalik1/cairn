/*
 * A core sample, laid in its box: one image (or a pool's images) as a
 * drilled cylinder whose length is the provisioned size. The written part
 * is solid rock, blocks only snapshots still hold are banded, the rest is
 * the hollow sleeve. Marks across it show limits (the pool's free room).
 * Numbers sit beside it in words.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';

export interface CorePart {
  key: string;
  label: string;
  value: number;
  fill: string;
  banded?: boolean;
}

export interface CoreMark {
  at: number;
  label: string;
  color: string;
}

export function CoreSample({
  length,
  parts,
  marks = [],
  label,
  height = 46,
  ticks,
}: {
  /** The full length (provisioned bytes). */
  length: number;
  parts: CorePart[];
  marks?: CoreMark[];
  label: string;
  height?: number;
  /** Tick labels at 0, ½ and the end. */
  ticks?: [string, string, string];
}) {
  const t = useTokens();
  const scale = Math.max(length, parts.reduce((n, p) => n + p.value, 0), ...marks.map(m => m.at), 1);
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  let x = 0;
  return (
    <Box sx={{ position: 'relative', pt: marks.length ? 2.75 : 0, pb: ticks ? 2.25 : 0 }}>
      <Box
        role="img"
        aria-label={label}
        sx={{
          position: 'relative',
          height,
          width: w(length),
          minWidth: 40,
          borderRadius: `${height / 2}px`,
          border: `1px solid ${t.basaltEdge}`,
          background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 9px), rgba(255,255,255,0.03)`,
          overflow: 'hidden',
        }}
      >
        {parts.map(p => {
          const left = x;
          x += p.value;
          return (
            <Box
              key={p.key}
              title={p.label}
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${(left / Math.max(length, 1)) * 100}%`,
                width: `${Math.min(100, (p.value / Math.max(length, 1)) * 100)}%`,
                minWidth: p.value > 0 ? 3 : 0,
                background: p.banded
                  ? `repeating-linear-gradient(90deg, ${p.fill} 0 3px, ${p.fill}55 3px 7px)`
                  : `repeating-linear-gradient(90deg, ${p.fill} 0 14px, ${p.fill}e6 14px 15px, ${p.fill} 15px 23px, ${p.fill}cc 23px 24px)`,
              }}
            />
          );
        })}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 38%, rgba(0,0,0,0.0) 55%, rgba(0,0,0,0.32) 100%)',
            pointerEvents: 'none',
          }}
        />
      </Box>
      {marks.map(m => (
        <Box key={m.label} aria-hidden sx={{ position: 'absolute', top: 0, bottom: ticks ? 18 : 0, left: w(m.at), borderLeft: `1.5px dashed ${m.color}` }}>
          <Box
            component="span"
            sx={{
              position: 'absolute',
              top: -2,
              left: (m.at / scale) > 0.7 ? 'auto' : 6,
              right: (m.at / scale) > 0.7 ? 6 : 'auto',
              whiteSpace: 'nowrap',
              fontSize: 11.5,
              color: m.color,
              ...tabular,
            }}
          >
            {m.label}
          </Box>
        </Box>
      ))}
      {ticks && (
        <Box sx={{ position: 'absolute', left: 0, bottom: 0, width: w(length), minWidth: 40, display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: t.basaltMuted, ...tabular }}>
          {ticks.map((x, i) => (
            <span key={i}>{x}</span>
          ))}
        </Box>
      )}
    </Box>
  );
}
