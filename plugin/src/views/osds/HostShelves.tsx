/*
 * The loud element of Hosts & OSDs: one shelf per CRUSH host, named by
 * its Kubernetes node, with a drive bay per OSD (fill level, up/down and
 * in/out, device class, size, placement groups, latency). A bay opens its
 * OSD; a shelf starts or finishes the host's maintenance.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { bytes, ms, plural } from '../../model/format';
import { fillTone, osdStateWord, osdTone, Ratios, ratiosOf, Shelf, shelves } from '../../model/osd';
import { Osd } from '../../model/types';
import { useNav } from '../../shell/nav';
import { Band } from '../../ui/kit';
import { Mark } from '../../ui/Mark';
import { STATE, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { useCephReason } from '../overview/common';
import { useNodeFlags } from './flags';
import { finishHostMaintenance, openMaintenance } from './ops';

const FILL = { ok: '#5B97EA', warn: STATE.warn, err: STATE.err, move: STATE.move, idle: STATE.idle };

export function Bay({ osd, r, onOpen, large }: { osd: Osd; r: Ratios; onOpen?: () => void; large?: boolean }) {
  const t = useTokens();
  const tone = osdTone(osd);
  const fill = fillTone(osd.utilization, r);
  const u = Math.max(0, Math.min(100, osd.utilization));
  const w = large ? 150 : 116;
  const h = large ? 110 : 62;
  const body = (
    <Box sx={{ width: w, display: 'flex', flexDirection: 'column', gap: 0.6, textAlign: 'left', color: t.basaltText }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box component="span" sx={{ fontFamily: t.font.mono, fontSize: large ? 16 : 13.5, fontWeight: 600 }}>
          {osd.name}
        </Box>
        {osd.flags.length > 0 && (
          <Box component="span" sx={{ fontSize: 11, color: STATE.warn, border: `1px solid ${STATE.warn}88`, borderRadius: '3px', px: 0.5 }}>
            {osd.flags.join(' ')}
          </Box>
        )}
      </Box>
      <Box
        aria-hidden
        sx={{
          position: 'relative',
          height: h,
          borderRadius: '4px',
          border: `1px solid ${t.basaltEdge}`,
          background: 'rgba(255,255,255,0.05)',
          overflow: 'hidden',
          opacity: osd.up ? 1 : 0.55,
        }}
      >
        <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${u}%`, background: FILL[fill], opacity: 0.85 }} />
        {[r.nearFull, r.full].map(x => (
          <Box key={x} sx={{ position: 'absolute', left: 0, right: 0, bottom: `${x * 100}%`, borderTop: `1px dashed ${t.basaltMuted}`, opacity: 0.5 }} />
        ))}
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: large ? 18 : 13, fontWeight: 600, ...tabular }}>
          {Math.round(u)}%
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 12.5 }}>
        <Mark tone={tone} size={8} />
        {osdStateWord(osd)}
      </Box>
      <Box sx={{ fontSize: 12, color: t.basaltMuted, lineHeight: 1.45, ...tabular }}>
        {osd.deviceClass || 'no class'}, {bytes(osd.sizeBytes)}
        <br />
        {plural(osd.pgs, 'PG')}
        {osd.commitMs !== undefined ? `, ${ms(osd.commitMs)}` : ''}
      </Box>
    </Box>
  );
  if (!onOpen) return body;
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={`${osd.name}: ${osdStateWord(osd)}, ${Math.round(u)}% full. Open`}
      sx={{
        p: 1,
        borderRadius: '6px',
        border: `1px solid transparent`,
        '&:hover': { background: 'rgba(255,255,255,0.05)', borderColor: t.basaltEdge },
        '&:focus-visible': { outline: `2px solid ${t.basaltText}`, outlineOffset: 1 },
      }}
    >
      {body}
    </ButtonBase>
  );
}

function ShelfBox({ s, r, inMaint }: { s: Shelf; r: Ratios; inMaint: boolean }) {
  const t = useTokens();
  const nav = useNav();
  const c = useCeph();
  const reason = useCephReason();
  const [err, setErr] = React.useState<string | null>(null);
  const label = s.host || 'Outside any host';
  const node = s.node && s.node !== s.host ? s.node : '';
  const run = async (f: () => Promise<void>) => {
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Box
      component="section"
      aria-label={`Host ${label}`}
      sx={{ border: `1px solid ${t.basaltEdge}`, borderRadius: '8px', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, background: 'rgba(0,0,0,0.12)' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h3" sx={{ fontSize: 14.5, fontWeight: 600, color: t.basaltText, fontFamily: t.font.mono, overflowWrap: 'anywhere' }}>
            {node || label}
          </Typography>
          <Box sx={{ fontSize: 12.5, color: t.basaltMuted, ...tabular }}>
            {node ? `CRUSH host ${label}, ` : s.host ? 'CRUSH host and node, ' : ''}
            {s.up} of {s.osds.length} up, {Math.round(s.utilization)}% of {bytes(s.sizeBytes)} used
          </Box>
        </Box>
        {inMaint && (
          <Box sx={{ fontSize: 12, color: STATE.warn, border: `1px solid ${STATE.warn}88`, borderRadius: '4px', px: 0.75, py: 0.25, whiteSpace: 'nowrap' }}>
            In maintenance
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {s.osds.map(o => (
          <Bay key={o.id} osd={o} r={r} onOpen={() => nav.go('osds', String(o.id))} />
        ))}
      </Box>
      {s.host && (
        <Box>
          <Button
            size="small"
            variant="outlined"
            disabled={!!reason}
            title={reason ?? undefined}
            onClick={() =>
              run(async () =>
                inMaint ? finishHostMaintenance(c.ns, s.host, s.osds, c.refresh) : openMaintenance(c.ns, { osds: s.osds, host: s.host, node: s.node }, c.refresh)
              )
            }
            sx={{ textTransform: 'none', color: t.basaltText, borderColor: t.basaltEdge, '&:hover': { borderColor: t.basaltMuted } }}
          >
            {inMaint ? 'Finish maintenance…' : 'Maintenance…'}
          </Button>
        </Box>
      )}
      {err && <Box sx={{ fontSize: 12.5, color: '#F2A3AA' }}>{err}</Box>}
    </Box>
  );
}

export function HostShelves() {
  const t = useTokens();
  const { core } = useCeph();
  const r = ratiosOf(core.osdMap);
  const list = shelves(core.hosts, core.osds);
  const nodeFlags = useNodeFlags();
  const up = core.osds.filter(o => o.up).length;
  const inn = core.osds.filter(o => o.in).length;
  return (
    <Band>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography component="h2" sx={{ fontSize: 20, fontWeight: 650, color: t.basaltText, flex: 1 }}>
          {plural(list.filter(s => s.host).length, 'host')}, {plural(core.osds.length, 'OSD')}: {up === core.osds.length ? 'all up' : `${up} up`}
          {inn === core.osds.length ? ' and in' : `, ${inn} in`}
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: t.basaltMuted }}>
          Fill marks at {Math.round(r.nearFull * 100)}% (near full) and {Math.round(r.full * 100)}% (full). Open a drive for its details and
          operations.
        </Typography>
      </Box>
      {list.length === 0 ? (
        <Typography sx={{ color: t.basaltMuted }}>No OSDs yet: add a disk or node to the CephCluster storage below.</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 1.5 }}>
          {list.map(s => (
            <ShelfBox key={s.host || '-'} s={s} r={r} inMaint={!!s.host && (nodeFlags[s.host] ?? []).includes('noout')} />
          ))}
        </Box>
      )}
    </Band>
  );
}
