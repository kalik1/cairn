/*
 * Cairn's alerts (model/alerts.ts): what Ceph's health does not say, each
 * with the view that fixes it.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { Alert, deriveAlerts } from '../../model/alerts';
import { Notice, Panel } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { useOperator } from '../daemons/useOperator';
import { Hint, ViewLink } from './common';

export function useAlerts(): Alert[] {
  const { core } = useCeph();
  const kube = useKube();
  const operator = useOperator();
  return React.useMemo(
    () =>
      deriveAlerts({
        osdMap: core.osdMap,
        osds: core.osds,
        quorum: core.quorum,
        mgr: core.mgr,
        pools: core.pools,
        autoscale: core.autoscale,
        crashes: core.crashes,
        cephCluster: kube.cephCluster,
        operator,
      }),
    [core, kube.cephCluster, operator]
  );
}

const WORD = { err: 'Act now', warn: 'Attention', idle: 'Note' } as const;

export function Alerts() {
  const t = useTokens();
  const alerts = useAlerts();
  return (
    <Panel title="Cairn alerts" icon="mdi:bell-outline" id="alerts" actions={<Hint>Beyond Ceph’s health</Hint>}>
      {alerts.length === 0 ? (
        <Notice tone="ok">Nothing else needs attention: flags, OSDs, monitors, managers, Rook and pools look right.</Notice>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {alerts.map((a, i) => (
            <Box
              component="li"
              key={a.id}
              sx={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 1.5, py: 1, borderTop: i ? `1px solid ${t.rule}` : 'none', fontSize: 13.5 }}
            >
              <Box sx={{ pt: 0.1 }}>
                <StateLabel tone={a.tone} size="sm">
                  {WORD[a.tone]}
                </StateLabel>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ fontWeight: 600 }}>{a.title}</Box>
                {a.detail && <Box sx={{ color: t.muted, lineHeight: 1.5 }}>{a.detail}</Box>}
                {a.link && (
                  <Box sx={{ mt: 0.25 }}>
                    <ViewLink view={a.link.view} a={a.link.a}>
                      {a.link.label}
                    </ViewLink>
                  </Box>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Panel>
  );
}
