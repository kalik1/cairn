/*
 * The app-bar health badge: Ceph's health as Rook last saw it (the
 * CephCluster status, refreshed every 30 s, no exec needed), the checks in
 * its tooltip, a click opens the Cairn overview. Hidden outside a cluster
 * and where there is no Rook.
 */

import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { currentCluster } from '../api/client';
import { CephCluster } from '../api/resources';
import { summarize } from '../model/badge';
import { CairnMark } from '../ui/CairnMark';
import { healthTone } from '../ui/health';
import { hrefFor } from './nav';

function Badge() {
  const history = useHistory();
  const res: any = (CephCluster as any).useList({ refetchInterval: 30000 });
  const items: any[] | null = res?.items ?? res?.[0] ?? null;
  if (!items || items.length === 0) return null;
  const cc = [...items].sort((a, b) => (a.metadata.creationTimestamp ?? '').localeCompare(b.metadata.creationTimestamp ?? ''))[0];
  const s = summarize(cc?.jsonData ?? cc);
  const tone = healthTone(s.status);
  const tip = (
    <Box sx={{ fontSize: 13, lineHeight: 1.5, maxWidth: 360 }}>
      <Box sx={{ fontWeight: 600 }}>{s.text}</Box>
      {s.checks.map(c => (
        <Box key={c.code}>
          {c.severity === 'HEALTH_ERR' ? 'Error' : 'Warning'}: {c.message}
        </Box>
      ))}
      {items.length > 1 && <Box sx={{ mt: 0.5, opacity: 0.8 }}>{items.length} Ceph clusters: showing the first</Box>}
      {s.checked && <Box sx={{ mt: 0.5, opacity: 0.8 }}>Checked {new Date(s.checked).toLocaleTimeString()}. Click to open Cairn.</Box>}
    </Box>
  );
  return (
    <Tooltip title={tip}>
      <ButtonBase
        onClick={() => history.push(hrefFor('overview'))}
        aria-label={`${s.text}. Open the Ceph overview`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.5,
          mx: 0.5,
          borderRadius: 1,
          fontSize: 13.5,
          fontWeight: 500,
          color: 'inherit',
          whiteSpace: 'nowrap',
          '&:hover': { background: 'rgba(127,127,127,0.12)' },
          '&:focus-visible': { outline: '2px solid currentColor' },
        }}
      >
        <CairnMark size={18} tone={tone} />
        <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
          {s.text}
        </Box>
      </ButtonBase>
    </Tooltip>
  );
}

export function HealthBadge() {
  if (!currentCluster()) return null;
  return <Badge />;
}
