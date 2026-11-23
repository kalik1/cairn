/*
 * The placement-group field: every PG as a small stone, grouped by pool,
 * coloured by its state category (model/pg.ts). One tab stop; arrow keys
 * move between stones; pointing at or focusing a stone shows its PG in the
 * readout, a click pins it there with links to its pool and OSDs.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { PG_CATEGORY_INFO, PgCategory, PgCounts, PgSummary } from '../../model/pg';
import { PgBrief } from '../../model/types';
import { Mono } from '../../ui/kit';
import { STATE } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { ViewLink } from './common';

type Cell = PgBrief & { category: PgCategory };

/** Stone look per category, on the basalt band. */
export function stoneStyle(c: PgCategory): Record<string, string> {
  switch (c) {
    case 'clean':
      return { background: `${STATE.ok}C0` };
    case 'scrubbing':
      return { background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${STATE.move}` };
    case 'moving':
      return { background: STATE.move };
    case 'degraded':
      return { background: STATE.warn };
    case 'inactive':
      return { background: STATE.err };
    case 'damaged':
      return { background: `repeating-linear-gradient(135deg, ${STATE.err} 0 2px, #F2B8BD 2px 3.5px)` };
  }
}

function sizeFor(total: number): { cell: number; gap: number } {
  if (total <= 256) return { cell: 14, gap: 3 };
  if (total <= 1024) return { cell: 10, gap: 2 };
  if (total <= 4096) return { cell: 7, gap: 1.5 };
  return { cell: 5, gap: 1 };
}

const LEGEND_ORDER: PgCategory[] = ['clean', 'scrubbing', 'moving', 'degraded', 'inactive', 'damaged'];

export function PgLegend({ counts, onBasalt = true }: { counts: PgCounts; onBasalt?: boolean }) {
  const t = useTokens();
  return (
    <Box component="ul" aria-label="Placement group states" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: 1.75, fontSize: 13 }}>
      {LEGEND_ORDER.map(c => (
        <Box
          component="li"
          key={c}
          title={PG_CATEGORY_INFO[c].help}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, opacity: counts[c] ? 1 : 0.55, fontVariantNumeric: 'tabular-nums' }}
        >
          <Box component="span" aria-hidden sx={{ width: 11, height: 11, borderRadius: '3px', flex: 'none', ...stoneStyle(c) }} />
          <span>{PG_CATEGORY_INFO[c].label}</span>
          <Box component="span" sx={{ color: onBasalt ? t.basaltMuted : t.muted }}>
            {counts[c]}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function PgField({ summary, poolName }: { summary: PgSummary; poolName: (id: number) => string }) {
  const t = useTokens();
  const { cell, gap } = sizeFor(summary.total);
  const flat = React.useMemo(() => summary.pools.flatMap(p => p.pgs), [summary]);
  const index = React.useMemo(() => new Map(flat.map((p, i) => [p.pgid, i])), [flat]);
  const [active, setActive] = React.useState(0);
  const [hover, setHover] = React.useState<number | null>(null);
  const [pinned, setPinned] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  const refs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const gridRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const act = Math.min(active, Math.max(0, flat.length - 1));
  const pinnedCell = pinned !== null ? flat[index.get(pinned) ?? -1] : undefined;
  const shown: Cell | undefined = hover !== null ? flat[hover] : focused ? flat[act] : pinnedCell;

  const colsOf = (pool: number) => {
    const el = gridRefs.current.get(pool);
    if (!el) return 1;
    return Math.max(1, Math.floor((el.clientWidth + gap) / (cell + gap)));
  };
  const move = (to: number) => {
    const i = Math.max(0, Math.min(flat.length - 1, to));
    setActive(i);
    refs.current[i]?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const cur = flat[act];
    if (!cur) return;
    const cols = colsOf(cur.pool);
    const map: Record<string, number> = {
      ArrowRight: act + 1,
      ArrowLeft: act - 1,
      ArrowDown: act + cols,
      ArrowUp: act - cols,
      Home: 0,
      End: flat.length - 1,
    };
    if (e.key in map) {
      e.preventDefault();
      move(map[e.key]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPinned(p => (p === cur.pgid ? null : cur.pgid));
    } else if (e.key === 'Escape') setPinned(null);
  };
  const cellAt = (e: React.SyntheticEvent) => {
    const v = (e.target as HTMLElement).dataset?.i;
    return v === undefined ? null : Number(v);
  };

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        onMouseOver={e => {
          const i = cellAt(e);
          if (i !== null) setHover(i);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={e => {
          const i = cellAt(e);
          if (i === null) return;
          setActive(i);
          setPinned(p => (p === flat[i].pgid ? null : flat[i].pgid));
        }}
        onKeyDown={onKey}
        onFocus={() => setFocused(true)}
        onBlur={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, maxHeight: 480, overflowY: 'auto', pr: 0.5 }}
      >
        {summary.pools.map(p => (
          <Box key={p.pool} role="group" aria-label={`Placement groups of pool ${poolName(p.pool)}`}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', fontSize: 12.5, color: t.basaltMuted, mb: 0.5 }}>
              <Box component="span" sx={{ color: t.basaltText, fontWeight: 550 }}>
                {poolName(p.pool)}
              </Box>
              <span>{p.pgs.length === 1 ? '1 PG' : `${p.pgs.length} PGs`}</span>
            </Box>
            <Box
              ref={(el: HTMLDivElement | null) => {
                if (el) gridRefs.current.set(p.pool, el);
                else gridRefs.current.delete(p.pool);
              }}
              sx={{ display: 'flex', flexWrap: 'wrap', gap: `${gap}px` }}
            >
              {p.pgs.map(pg => {
                const i = index.get(pg.pgid) ?? 0;
                const isPinned = pinned === pg.pgid;
                return (
                  <Box
                    component="span"
                    key={pg.pgid}
                    ref={(el: HTMLSpanElement | null) => (refs.current[i] = el)}
                    data-i={i}
                    role="button"
                    tabIndex={i === act ? 0 : -1}
                    aria-pressed={isPinned}
                    aria-label={`PG ${pg.pgid}: ${pg.state || 'unknown'}, ${PG_CATEGORY_INFO[pg.category].label}`}
                    onFocus={() => setActive(i)}
                    sx={{
                      width: cell,
                      height: cell,
                      borderRadius: `${Math.max(1.5, cell / 4)}px`,
                      cursor: 'pointer',
                      flex: 'none',
                      outline: isPinned ? `2px solid ${t.basaltText}` : 'none',
                      outlineOffset: 1,
                      ...stoneStyle(pg.category),
                      '&:hover': { filter: 'brightness(1.35)' },
                      '&:focus-visible': { outline: `2px solid ${t.basaltText}`, outlineOffset: 1 },
                    }}
                  />
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
      <Box aria-live="polite" sx={{ mt: 1.25, minHeight: 40, fontSize: 13, color: t.basaltMuted, lineHeight: 1.55, '& a': { color: '#9CC2F5' } }}>
        {shown ? (
          <Readout pg={shown} pool={poolName(shown.pool)} pinned={!!pinnedCell && shown.pgid === pinnedCell.pgid} />
        ) : (
          'Point at a placement group, or tab into the field and use the arrow keys. Click to keep it here.'
        )}
      </Box>
    </Box>
  );
}

function Readout({ pg, pool, pinned }: { pg: Cell; pool: string; pinned: boolean }) {
  const t = useTokens();
  const info = PG_CATEGORY_INFO[pg.category];
  const osds = (list: number[]) =>
    list.length
      ? list.map((o, i) => (
          <React.Fragment key={`${o}-${i}`}>
            {i > 0 && ', '}
            {pinned && o >= 0 ? (
              <ViewLink view="osds" a={String(o)}>
                osd.{o}
              </ViewLink>
            ) : (
              <Mono>{o >= 0 ? `osd.${o}` : 'none'}</Mono>
            )}
          </React.Fragment>
        ))
      : 'none';
  const sameSet = pg.up.join(',') === pg.acting.join(',');
  return (
    <Box>
      <Box sx={{ color: t.basaltText }}>
        PG <Mono>{pg.pgid}</Mono> of {pinned ? <ViewLink view="pools" a={pool}>{pool}</ViewLink> : pool}:{' '}
        <Box component="span" sx={{ fontWeight: 600, color: STATE[info.tone === 'idle' ? 'idle' : info.tone] }}>
          {info.label}
        </Box>{' '}
        <Mono>({pg.state || 'unknown'})</Mono>
      </Box>
      <Box>
        Acting {osds(pg.acting)}
        {pg.primary >= 0 && (
          <>
            ; primary <Mono>osd.{pg.primary}</Mono>
          </>
        )}
        {!sameSet && <>; CRUSH wants {osds(pg.up)}</>}.
      </Box>
    </Box>
  );
}
