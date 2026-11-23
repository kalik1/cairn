/*
 * What Rook reports about Ceph, for users who cannot read Ceph's live
 * state (no exec in the Rook namespace): the CephCluster status keeps
 * Ceph's health with every check's message, the raw capacity and the
 * daemons' versions, refreshed by Rook about once a minute.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useKube } from '../../api/kube';
import { bytes, pct } from '../../model/format';
import { checkInfo } from '../../model/health';
import { parseVersions } from '../../model/parse';
import { healthTone, healthWord } from '../../ui/health';
import { Band, Figure, KV, Meter, Mono, Panel, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { STATE } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { DocLink } from './common';

export function RookReport() {
  const t = useTokens();
  const { cephCluster: cc } = useKube();
  const st = cc?.status?.ceph ?? {};
  const cap = st.capacity ?? {};
  const checks = Object.entries((st.details ?? {}) as Record<string, { message?: string; severity?: string }>);
  const versions = parseVersions(st.versions ?? {});
  const tone = healthTone(st.health);
  if (!cc) return null;
  return (
    <>
      <Band>
        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Box sx={{ flex: '1 1 380px', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box component="span" sx={{ width: 14, height: 14, borderRadius: '4px', background: STATE[tone], flex: 'none' }} />
              <Typography component="h2" sx={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.01em' }}>
                Ceph: {healthWord(st.health).toLowerCase()}
                {checks.length ? `, ${checks.length} check${checks.length > 1 ? 's' : ''} active` : ''}
              </Typography>
            </Box>
            <Typography sx={{ color: t.basaltMuted, fontSize: 13.5, mt: 1, maxWidth: 640 }}>
              As Rook last reported it in the CephCluster status (<When at={st.lastChecked} />). Placement groups, OSDs and operations
              need Ceph's live state.
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Figure onBand value={bytes(cap.bytesUsed)} label="raw used" sub={cap.bytesTotal ? `${pct(cap.bytesUsed / cap.bytesTotal)} of ${bytes(cap.bytesTotal)}` : undefined} />
            <Figure onBand value={bytes(cap.bytesAvailable)} label="raw available" />
            <Figure onBand value={cc.status?.phase ?? '—'} label="CephCluster phase" />
          </Box>
        </Box>
        {cap.bytesTotal > 0 && (
          <Box sx={{ mt: 2.5, maxWidth: 720, '& p': { color: t.basaltMuted } }}>
            <Meter used={cap.bytesUsed} total={cap.bytesTotal} format={bytes} height={10} />
          </Box>
        )}
      </Band>
      <Panel title="Health checks Rook reports" icon="mdi:stethoscope" actions={<StateLabel tone={tone}>{healthWord(st.health)}</StateLabel>}>
        {checks.length === 0 ? (
          <Typography sx={{ fontSize: 14, color: t.muted }}>No active check.</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {checks.map(([code, d]) => {
              const info = checkInfo(code, { summary: d.message ?? code });
              const sev = d.severity === 'HEALTH_ERR' ? 'err' : 'warn';
              return (
                <Box key={code} sx={{ borderLeft: `3px solid ${STATE[sev]}`, pl: 1.5 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <StateLabel tone={sev}>{sev === 'err' ? 'Error' : 'Warning'}</StateLabel>
                    <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{info.title}</Typography>
                    <Mono muted>{code}</Mono>
                  </Box>
                  <Typography sx={{ fontSize: 13.5, mt: 0.25 }}>{d.message}</Typography>
                  {info.known && <Typography sx={{ fontSize: 13.5, color: t.muted, mt: 0.5 }}>{info.meaning}</Typography>}
                  <Box sx={{ mt: 0.5, fontSize: 13 }}>
                    <DocLink href={info.docs}>Ceph documentation</DocLink>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Panel>
      {Object.keys(versions).length > 0 && (
        <Panel title="Daemon versions" icon="mdi:tag-outline">
          <KV rows={Object.entries(versions).map(([daemon, v]) => [daemon, Object.entries(v).map(([ver, n]) => `${n} on ${ver}`).join(', ')])} />
        </Panel>
      )}
    </>
  );
}
