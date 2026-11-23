/*
 * The daemons in one row: monitors in quorum, managers, OSDs up and in,
 * MDS, RGW; each links to its view.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { plural } from '../../model/format';
import type { View } from '../../shell/nav';
import { Panel } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { StateTone } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { ViewLink } from './common';

interface Item {
  label: string;
  tone: StateTone;
  value: string;
  sub: string;
  view: View;
  a?: string;
}

export function DaemonSummary() {
  const t = useTokens();
  const { core } = useCeph();
  const kube = useKube();
  const s = core.status;
  const q = core.quorum;
  const mgr = core.mgr;
  const monTotal = q?.mons.length ?? s?.monCount ?? 0;
  const monIn = q?.quorum.length ?? s?.quorum.length ?? 0;
  const osdTotal = s?.osd.total ?? core.osds.length;
  const osdUp = s?.osd.up ?? core.osds.filter(o => o.up).length;
  const osdIn = s?.osd.in ?? core.osds.filter(o => o.in).length;
  const rgwPods = kube.rookPods.items.filter(p => p.metadata.labels?.app === 'rook-ceph-rgw');
  const rgwReady = rgwPods.filter(p => p.status?.phase === 'Running').length;
  const items: Item[] = [
    {
      label: 'Monitors',
      tone: !monTotal ? 'idle' : monIn === monTotal ? 'ok' : monIn * 2 > monTotal ? 'warn' : 'err',
      value: `${monIn} of ${monTotal} in quorum`,
      sub: q?.leader ? `leader mon.${q.leader}` : '',
      view: 'daemons',
      a: 'mons',
    },
    {
      label: 'Managers',
      tone: !mgr ? 'idle' : !mgr.available ? 'err' : mgr.standbys.length ? 'ok' : 'warn',
      value: mgr?.active ? `mgr.${mgr.active} active` : 'none active',
      sub: mgr ? (mgr.standbys.length ? `${plural(mgr.standbys.length, 'standby', 'standbys')}` : 'no standby') : '',
      view: 'daemons',
      a: 'mgr',
    },
    {
      label: 'OSDs',
      tone: !osdTotal ? 'idle' : osdUp < osdTotal ? 'err' : osdIn < osdTotal ? 'warn' : 'ok',
      value: `${osdUp} up, ${osdIn} in`,
      sub: `of ${plural(osdTotal, 'OSD')}`,
      view: 'osds',
    },
    {
      label: 'Metadata servers',
      tone: s && s.fs.up + s.fs.standby > 0 ? 'ok' : 'idle',
      value: s && s.fs.up + s.fs.standby > 0 ? `${s.fs.up} active` : 'none',
      sub: s && s.fs.up + s.fs.standby > 0 ? `${s.fs.standby} standby` : 'no file system',
      view: 'cephfs',
    },
    {
      label: 'Object gateways',
      tone: rgwPods.length ? (rgwReady === rgwPods.length ? 'ok' : 'warn') : 'idle',
      value: rgwPods.length ? `${rgwReady} of ${rgwPods.length} running` : 'none',
      sub: rgwPods.length ? 'RGW pods' : 'no object store',
      view: 'object',
    },
  ];
  return (
    <Panel dense>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {items.map((it, i) => (
          <Box key={it.label} sx={{ px: 2, py: 1.25, borderLeft: i ? `1px solid ${t.rule}` : 'none', minWidth: 0 }}>
            <Box sx={{ fontSize: 12.5, color: t.muted, mb: 0.25 }}>
              <ViewLink view={it.view} a={it.a}>
                {it.label}
              </ViewLink>
            </Box>
            <StateLabel tone={it.tone}>{it.value}</StateLabel>
            <Box sx={{ fontSize: 12.5, color: t.muted, mt: 0.25 }}>{it.sub || ' '}</Box>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}
