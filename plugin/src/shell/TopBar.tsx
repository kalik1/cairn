/*
 * The top bar: which Ceph cluster (and a picker when there are several),
 * its health in one word, the live stamp and refresh; below it the views.
 */

import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../api/ceph';
import { useKube } from '../api/kube';
import { CairnMark } from '../ui/CairnMark';
import { healthTone, healthWord } from '../ui/health';
import { IconAction } from '../ui/kit';
import { StateLabel } from '../ui/Mark';
import { useTokens } from '../ui/useTokens';
import { LiveStamp } from './Gate';
import { hrefFor, useNav, View } from './nav';
import { useSettings } from './settings';

export const TABS: { view: View; label: string }[] = [
  { view: 'overview', label: 'Overview' },
  { view: 'osds', label: 'Hosts & OSDs' },
  { view: 'daemons', label: 'Daemons' },
  { view: 'pools', label: 'Pools' },
  { view: 'rbd', label: 'Block' },
  { view: 'cephfs', label: 'File' },
  { view: 'object', label: 'Object' },
  { view: 'kubernetes', label: 'Kubernetes' },
  { view: 'security', label: 'Security' },
  { view: 'config', label: 'Configuration' },
  { view: 'activity', label: 'Activity' },
];

export function TopBar() {
  const t = useTokens();
  const nav = useNav();
  const kube = useKube();
  const ceph = useCeph();
  const [settings, update] = useSettings();
  const cc = kube.cephCluster;
  const status = ceph.core.status?.health.status ?? cc?.status?.ceph?.health;
  const tone = healthTone(status);
  const version = cc?.status?.version?.version?.replace(/-0$/, '') ?? '';
  const clusters = kube.cephClusters.items;
  const key = cc ? `${cc.metadata.namespace}/${cc.metadata.name}` : '';
  return (
    <Box component="header" sx={{ background: t.surface, borderBottom: `1px solid ${t.rule}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 2, md: 3 }, pt: 1.25, pb: 0.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CairnMark size={24} tone={cc ? tone : undefined} stone={t.dark ? '#6F7F89' : '#93A4AE'} />
          <Typography sx={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Cairn</Typography>
        </Box>
        {cc && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flexWrap: 'wrap' }}>
            {clusters.length > 1 ? (
              <Select
                size="small"
                value={key}
                onChange={e => update({ cluster: String(e.target.value) })}
                aria-label="Ceph cluster"
                sx={{ fontSize: 14, '& .MuiSelect-select': { py: 0.5 } }}
              >
                {clusters.map(c => (
                  <MenuItem key={c.metadata.uid} value={`${c.metadata.namespace}/${c.metadata.name}`}>
                    {c.metadata.namespace}/{c.metadata.name}
                  </MenuItem>
                ))}
              </Select>
            ) : (
              <Typography sx={{ fontSize: 14, color: t.muted }} noWrap>
                {cc.metadata.namespace}/{cc.metadata.name}
              </Typography>
            )}
            {version && (
              <Typography sx={{ fontSize: 13, color: t.muted }} noWrap>
                Ceph {version}
              </Typography>
            )}
            <StateLabel tone={tone}>{healthWord(status)}</StateLabel>
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <LiveStamp />
        <IconAction icon="mdi:refresh" label="Refresh now" onClick={() => ceph.refresh()} disabled={ceph.phase !== 'ready'} />
      </Box>
      <Tabs
        value={nav.view}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Cairn views"
        sx={{ px: { xs: 1, md: 2 }, minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 14, px: 1.5, minWidth: 0 } }}
      >
        {TABS.map(tab => (
          <Tab
            key={tab.view}
            value={tab.view}
            label={tab.label}
            component="a"
            href={hrefFor(tab.view)}
            onClick={(e: React.MouseEvent) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              nav.go(tab.view);
            }}
          />
        ))}
      </Tabs>
      {settings.bridge !== 'auto' && (
        <Box sx={{ px: 3, pb: 0.5, fontSize: 12, color: t.muted }}>
          <Icon icon="mdi:console" width={12} /> Ceph commands run in the {settings.bridge}
        </Box>
      )}
    </Box>
  );
}
