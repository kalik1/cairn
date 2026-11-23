/*
 * The overview's loud element: the verdict about data safety in one
 * sentence, what Ceph is doing about it (recovery, progress events), and
 * the field of every placement group.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { ago, bytes, count, duration, pct, plural, rate } from '../../model/format';
import { verdict } from '../../model/health';
import { countsFromStates, progressEta, recoveryEta, summarizePgs } from '../../model/pg';
import { healthWord } from '../../ui/health';
import { Band } from '../../ui/kit';
import { Mark } from '../../ui/Mark';
import { STATE, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { PgField, PgLegend } from './PgField';

/** A pool this young may still have PGs that are not active: they hold no data. */
const NEW_POOL_MS = 10 * 60 * 1000;

function BandFigure({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  const t = useTokens();
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ fontSize: 19, fontWeight: 600, lineHeight: 1.25, color: t.basaltText, ...tabular, whiteSpace: 'nowrap' }}>{value}</Box>
      <Box sx={{ fontSize: 12.5, color: t.basaltMuted }}>{label}</Box>
    </Box>
  );
}

function BandBar({ value, color, label, right }: { value: number; color: string; label: React.ReactNode; right?: React.ReactNode }) {
  const t = useTokens();
  const v = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, fontSize: 13, mb: 0.4, alignItems: 'baseline' }}>
        <Box sx={{ flex: 1, minWidth: 0, color: t.basaltText }}>{label}</Box>
        {right && <Box sx={{ color: t.basaltMuted, ...tabular, whiteSpace: 'nowrap' }}>{right}</Box>}
      </Box>
      <Box
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
        aria-label={typeof label === 'string' ? label : undefined}
        sx={{ height: 6, borderRadius: 1, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}
      >
        <Box sx={{ height: '100%', width: `${v * 100}%`, background: color, transition: 'width 0.6s', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />
      </Box>
    </Box>
  );
}

export function VerdictBand() {
  const t = useTokens();
  const { core } = useCeph();
  const s = core.status;
  const summary = React.useMemo(() => (core.pgs.length ? summarizePgs(core.pgs) : null), [core.pgs]);
  const counts = summary?.counts ?? (s ? countsFromStates(s.pg.byState) : null);
  const newInactive = React.useMemo(() => {
    if (!summary) return 0;
    const recent = new Set(core.pools.filter(p => p.createdAt && Date.now() - p.createdAt < NEW_POOL_MS).map(p => p.id));
    return summary.pools.filter(g => recent.has(g.pool)).reduce((n, g) => n + g.counts.inactive, 0);
  }, [summary, core.pools]);
  const v = verdict(s, core.health, counts, newInactive);
  const poolNames = React.useMemo(() => new Map(core.pools.map(p => [p.id, p.name])), [core.pools]);
  const poolName = (id: number) => poolNames.get(id) ?? `pool ${id}`;
  const r = s?.recovery;
  const events = core.progress.events;
  const done = [...core.progress.completed].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)).slice(0, 4);
  const moving = !!r && (r.degradedObjects > 0 || r.misplacedObjects > 0 || r.unfoundObjects > 0 || r.bytesPerSec > 0);
  const eta = r ? recoveryEta(r.degradedObjects + r.misplacedObjects, r.objectsPerSec) : null;
  const health = core.health ?? s?.health;
  const muted = health?.checks.filter(c => c.muted).length ?? 0;

  return (
    <Band>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(340px, 5fr) minmax(320px, 6fr)' }, gap: { xs: 3, lg: 4 } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Mark tone={v.tone} size={14} />
              <Typography component="h2" sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 650, lineHeight: 1.2, color: t.basaltText, letterSpacing: '-0.01em' }}>
                {v.title}
              </Typography>
            </Box>
            {v.detail && <Typography sx={{ mt: 0.75, fontSize: 14.5, color: t.basaltMuted, maxWidth: 640, lineHeight: 1.55 }}>{v.detail}</Typography>}
            {health && (
              <Typography sx={{ mt: 0.75, fontSize: 13, color: t.basaltMuted }}>
                Ceph health: {healthWord(health.status)}
                {health.checks.length > 0 &&
                  `, ${plural(health.checks.length, 'check')}${muted ? ` (${muted} muted)` : ''}`}
                .
              </Typography>
            )}
          </Box>
          {s && (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 2 }}>
              <BandFigure value={count(s.pg.total)} label={`placement groups in ${plural(s.pools, 'pool')}`} />
              <BandFigure value={count(s.objects)} label="objects" />
              <BandFigure value={bytes(s.dataBytes)} label="data stored" />
              <BandFigure value={`${pct(s.totalBytes ? s.usedBytes / s.totalBytes : 0)}`} label={`raw used of ${bytes(s.totalBytes)}`} />
            </Box>
          )}
          {(moving || events.length > 0) && r && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, pt: 1.5, borderTop: `1px solid ${t.basaltEdge}` }}>
              <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, color: t.basaltText }}>
                {r.bytesPerSec > 0 || r.objectsPerSec > 0
                  ? `Recovering at ${rate(r.bytesPerSec)}, ${count(r.objectsPerSec)} objects/s${eta ? `: about ${duration(eta)} left` : ''}`
                  : moving
                  ? 'Waiting to recover: nothing is moving right now'
                  : 'In progress'}
              </Typography>
              {r.degradedObjects > 0 && (
                <BandBar
                  value={r.degradedRatio}
                  color={STATE.warn}
                  label="Degraded copies (missing, being rebuilt)"
                  right={`${count(r.degradedObjects)} of ${count(r.degradedTotal)}, ${pct(r.degradedRatio)}`}
                />
              )}
              {r.misplacedObjects > 0 && (
                <BandBar
                  value={r.misplacedRatio}
                  color={STATE.move}
                  label="Misplaced copies (safe, being moved)"
                  right={`${count(r.misplacedObjects)} of ${count(r.misplacedTotal)}, ${pct(r.misplacedRatio)}`}
                />
              )}
              {r.unfoundObjects > 0 && (
                <Typography sx={{ fontSize: 13, color: STATE.err, fontWeight: 600 }}>{plural(r.unfoundObjects, 'object')} unfound: no reachable copy.</Typography>
              )}
              {events.map(e => {
                const left = progressEta(e);
                return (
                  <BandBar
                    key={e.id}
                    value={e.progress}
                    color={STATE.move}
                    label={e.message}
                    right={`${pct(e.progress, 0)}${left ? `, about ${duration(left)} left` : ''}`}
                  />
                );
              })}
            </Box>
          )}
          {!moving && events.length === 0 && done.length > 0 && (
            <Box sx={{ pt: 1.5, borderTop: `1px solid ${t.basaltEdge}` }}>
              <Typography component="h3" sx={{ fontSize: 13.5, fontWeight: 600, color: t.basaltText, mb: 0.5 }}>
                Recently finished
              </Typography>
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', fontSize: 13, color: t.basaltMuted, lineHeight: 1.6 }}>
                {done.map(e => (
                  <li key={e.id}>
                    {e.failed ? 'Failed: ' : ''}
                    {e.message}
                    {e.finishedAt ? `, ${ago(e.finishedAt)}` : ''}
                  </li>
                ))}
              </Box>
            </Box>
          )}
        </Box>
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box>
            <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, color: t.basaltText, mb: 0.75 }}>
              Placement groups
            </Typography>
            {counts && <PgLegend counts={counts} />}
          </Box>
          {summary ? (
            <PgField summary={summary} poolName={poolName} />
          ) : (
            <Typography sx={{ fontSize: 13, color: t.basaltMuted }}>
              The placement-group list is not loaded yet{s && s.pg.total > 4096 ? ' (large clusters refresh it once a minute)' : ''}.
            </Typography>
          )}
        </Box>
      </Box>
    </Band>
  );
}
