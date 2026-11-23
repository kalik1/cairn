/*
 * Hosts & OSDs (/ceph/osds, /ceph/osds/:osd): where the data lives. The
 * host shelves, every OSD in a table, the cluster flags, the disks Rook
 * uses; or one OSD in detail.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { LiveGate } from '../../shell/Gate';
import { Page } from '../../ui/kit';
import { ClusterFlags } from './flags';
import { HostShelves } from './HostShelves';
import { OsdDetail, OsdMissing } from './OsdDetail';
import { OsdTable } from './OsdTable';
import { StorageSpec } from './storage';

export function OsdsView({ osd }: { osd?: string }) {
  if (osd !== undefined && osd !== '')
    return (
      <LiveGate>
        <OneOsd id={osd.replace(/^osd\./, '')} />
      </LiveGate>
    );
  return (
    <Page title="Hosts & OSDs" subtitle="Where the data lives: every host with its drives, the cluster flags, and the disks Rook turns into OSDs.">
      <LiveGate>
        <HostShelves />
        <OsdTable />
      </LiveGate>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        <LiveGate compact what="cluster flags">
          <ClusterFlags />
        </LiveGate>
        <StorageSpec />
      </Box>
    </Page>
  );
}

function OneOsd({ id }: { id: string }) {
  const { core } = useCeph();
  const n = Number(id);
  const o = Number.isInteger(n) ? core.osds.find(x => x.id === n) : undefined;
  if (!o) return <OsdMissing id={id} />;
  return <OsdDetail osd={o} />;
}
