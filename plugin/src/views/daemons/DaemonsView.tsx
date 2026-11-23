/*
 * Daemons (/ceph/daemons/:tab): the quorum and managers on the band, then
 * tabs for monitors, managers, every daemon pod, and the Rook operator.
 */

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { duration, plural } from '../../model/format';
import { LiveGate } from '../../shell/Gate';
import { hrefFor, useNav } from '../../shell/nav';
import { Band, Page } from '../../ui/kit';
import { STATE, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { Mgr } from './Mgr';
import { Mons } from './Mons';
import { Operator } from './Operator';
import { Pods } from './Pods';
import { mixedVersions } from './pods';

const TABS = [
  { id: 'mons', label: 'Monitors' },
  { id: 'mgr', label: 'Managers' },
  { id: 'daemons', label: 'Daemon pods' },
  { id: 'operator', label: 'Rook operator' },
];

function Stone({ name, tone, note, hollow }: { name: string; tone: keyof typeof STATE; note?: string; hollow?: boolean }) {
  const t = useTokens();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, minWidth: 52 }}>
      <Box
        aria-hidden
        sx={{
          width: 30,
          height: 30,
          borderRadius: '9px',
          background: hollow ? 'transparent' : STATE[tone],
          border: hollow ? `2px solid ${STATE[tone]}` : 'none',
          boxSizing: 'border-box',
        }}
      />
      <Box sx={{ fontFamily: t.font.mono, fontSize: 12.5, color: t.basaltText }}>{name}</Box>
      <Box sx={{ fontSize: 11.5, color: t.basaltMuted, minHeight: 16 }}>{note ?? ''}</Box>
    </Box>
  );
}

function DaemonBand() {
  const t = useTokens();
  const { core } = useCeph();
  const q = core.quorum;
  const m = core.mgr;
  const v = core.versions;
  const mixed = mixedVersions(v);
  const overall = v?.overall ? Object.entries(v.overall) : [];
  const total = overall.reduce((n, [, c]) => n + c, 0);
  const inQ = q?.quorum.length ?? 0;
  const mons = q?.mons ?? [];
  return (
    <Band>
      <Box sx={{ display: 'flex', gap: { xs: 3, md: 6 }, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 650, color: t.basaltText }}>
            {mons.length ? (inQ === mons.length ? `Quorum of all ${mons.length} monitors` : `Quorum of ${inQ} of ${mons.length} monitors`) : 'Monitors'}
          </Typography>
          <Typography sx={{ fontSize: 13, color: t.basaltMuted, mb: 1.5, ...tabular }}>
            {q ? `Leader mon.${q.leader}, formed ${duration(q.ageSec)} ago` : 'Reading the quorum…'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }} role="list" aria-label="Monitors">
            {mons.map(mo => (
              <Box role="listitem" key={mo.name} aria-label={`mon.${mo.name}: ${mo.inQuorum ? 'in quorum' : 'out of quorum'}${mo.leader ? ', leader' : ''}`}>
                <Stone name={mo.name} tone={mo.inQuorum ? 'ok' : 'err'} note={mo.leader ? 'leader' : mo.inQuorum ? 'in' : 'out'} />
              </Box>
            ))}
          </Box>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 650, color: t.basaltText }}>
            {m?.active ? `mgr.${m.active} active` : 'No active manager'}
          </Typography>
          <Typography sx={{ fontSize: 13, color: t.basaltMuted, mb: 1.5 }}>
            {m ? (m.standbys.length ? `${plural(m.standbys.length, 'standby', 'standbys')} ready to take over` : 'No standby') : 'Reading the managers…'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {m?.active && <Stone name={m.active} tone={m.available ? 'ok' : 'err'} note="active" />}
            {(m?.standbys ?? []).map(s => (
              <Stone key={s} name={s} tone="idle" hollow note="standby" />
            ))}
          </Box>
        </Box>
        <Box sx={{ minWidth: 220, flex: 1 }}>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 650, color: mixed.length ? STATE.warn : t.basaltText }}>
            {!v ? 'Versions' : mixed.length ? 'Mixed Ceph versions' : `All ${total} daemons on ${overall[0]?.[0] ?? '—'}`}
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0, fontSize: 13, color: t.basaltMuted, lineHeight: 1.7, ...tabular }}>
            {Object.entries(v ?? {})
              .filter(([k]) => k !== 'overall')
              .map(([k, vs]) => (
                <li key={k}>
                  <Box component="span" sx={{ color: t.basaltText, fontFamily: t.font.mono }}>
                    {k}
                  </Box>{' '}
                  {Object.entries(vs)
                    .map(([ver, n]) => (mixed.length ? `${n} on ${ver}` : String(n)))
                    .join(', ')}
                </li>
              ))}
          </Box>
        </Box>
      </Box>
    </Band>
  );
}

export function DaemonsView({ tab }: { tab?: string }) {
  const nav = useNav();
  const current = TABS.find(x => x.id === tab)?.id ?? 'mons';
  return (
    <Page title="Daemons" subtitle="The monitors and their quorum, the managers and their modules, every Ceph pod, and the Rook operator that runs them.">
      <LiveGate compact>
        <DaemonBand />
      </LiveGate>
      <Tabs
        value={current}
        aria-label="Daemon views"
        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 14, px: 1.5, minWidth: 0 } }}
      >
        {TABS.map(x => (
          <Tab
            key={x.id}
            value={x.id}
            label={x.label}
            component="a"
            href={hrefFor('daemons', x.id)}
            onClick={(e: React.MouseEvent) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              nav.go('daemons', x.id);
            }}
          />
        ))}
      </Tabs>
      {current === 'mons' && (
        <LiveGate>
          <Mons />
        </LiveGate>
      )}
      {current === 'mgr' && (
        <LiveGate>
          <Mgr />
        </LiveGate>
      )}
      {current === 'daemons' && <Pods />}
      {current === 'operator' && <Operator />}
    </Page>
  );
}
