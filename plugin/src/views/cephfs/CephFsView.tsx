/*
 * File (CephFS): the file systems with their metadata servers on the
 * basalt band, subvolume groups, the Kubernetes volumes made from them;
 * one file system in detail at /ceph/cephfs/<fs>.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { deleteSubvolumeGroup, svgBlockers } from '../../api/fsOps';
import { useKube } from '../../api/kube';
import { rookAttrs, useCan } from '../../api/permissions';
import { CephFs, cephfsCsi, cephfsVolumes, fsState, FsVolume, pinningWord, rookFsPools, standbysFor, svgGroupName } from '../../model/cephfs';
import { bytes, count, plural } from '../../model/format';
import { Obj } from '../../model/types';
import { hrefFor, useNav } from '../../shell/nav';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Band, Empty, IconAction, Mono, Notice, Page, Panel } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { explain, PhaseLabel } from './formkit';
import { FsDetail } from './FsDetail';
import { openCreateFs, openCreateSvg } from './fsDialogs';
import { BandFigure, Go, RankStone, StandbyStone, useFsMap } from './fsParts';

export function CephFsView({ fs }: { fs?: string }) {
  if (fs) return <FsDetail key={fs} name={fs} />;
  return <FsList />;
}

/** The CephFS CSI notice: without the driver, pods cannot mount these file systems. */
export function CsiNotice() {
  const kube = useKube();
  const csi = cephfsCsi(kube.csiDrivers.items, kube.storageClasses.items);
  if (csi.present || !kube.csiDrivers.loaded) return null;
  return (
    <Notice tone="idle" icon="mdi:puzzle-outline" title="Pods cannot mount CephFS volumes here yet">
      This cluster has no CephFS CSI driver{csi.others.length ? ` (only ${csi.others.join(', ')})` : ''}. File systems work in Ceph, but Kubernetes volumes on
      them need the CephFS driver of Ceph-CSI: with Rook 1.17 or later, enable it in the ceph-csi-drivers Helm chart (drivers.cephfs.enabled: true, driver{' '}
      {kube.ns}.cephfs.csi.ceph.com); with older Rook, set ROOK_CSI_ENABLE_CEPHFS in rook-ceph-operator-config. Then add a StorageClass with that provisioner.
    </Notice>
  );
}

function FsList() {
  const kube = useKube();
  const ceph = useCeph();
  const nav = useNav();
  const t = useTokens();
  const live = useFsMap();
  const canCreate = useCan(rookAttrs('create', 'cephfilesystems', kube.ns));
  const canSvg = useCan(rookAttrs('create', 'cephfilesystemsubvolumegroups', kube.ns));
  const canDelSvg = useCan(rookAttrs('delete', 'cephfilesystemsubvolumegroups', kube.ns));
  const crs = kube.filesystems.items.filter(x => x.metadata.namespace === kube.ns);
  const svgs = kube.subVolumeGroups.items.filter(x => x.metadata.namespace === kube.ns);
  const vols = cephfsVolumes(kube.pvs.items);
  const names = [...new Set([...crs.map(c => c.metadata.name), ...live.filesystems.map(f => f.name)])].sort();
  const nothing = kube.filesystems.loaded && !names.length;

  const svgCols: Column<Obj>[] = [
    { id: 'name', header: 'Group', cell: g => <Mono>{g.metadata.name}</Mono>, sort: g => g.metadata.name },
    { id: 'fs', header: 'File system', cell: g => <Go to={hrefFor('cephfs', g.spec?.filesystemName)}>{g.spec?.filesystemName}</Go>, sort: g => g.spec?.filesystemName ?? '' },
    { id: 'ceph', header: 'Ceph group', cell: g => <Mono>{svgGroupName(g)}</Mono>, minWidth: 900 },
    { id: 'phase', header: 'State', cell: g => <PhaseLabel phase={g.status?.phase} />, sort: g => g.status?.phase ?? '' },
    { id: 'quota', header: 'Quota', cell: g => g.spec?.quota ?? 'None', sort: g => String(g.spec?.quota ?? '') },
    { id: 'pin', header: 'Pinning', cell: g => pinningWord(g), minWidth: 800 },
    {
      id: 'act',
      header: '',
      align: 'right',
      width: 48,
      cell: g => (
        <IconAction
          icon="mdi:delete-outline"
          label={canDelSvg ? `Delete ${g.metadata.name}` : 'Your role does not allow deleting subvolume groups'}
          disabled={!canDelSvg}
          onClick={() => {
            const why = svgBlockers(g, kube.pvs.items, null);
            if (why.length) return explain({ title: `${g.metadata.name} still holds volumes`, lines: why });
            deleteSubvolumeGroup(g, {});
          }}
        />
      ),
    },
  ];

  return (
    <Page
      title="File systems"
      subtitle="CephFS file systems: their metadata servers, pools and subvolume groups, and the Kubernetes volumes made from them."
      actions={
        <>
          <Action icon="mdi:folder-plus-outline" onClick={() => openCreateSvg()} reason={!crs.length ? 'Create a file system first' : canSvg ? null : 'Your role does not allow creating subvolume groups'}>
            Create subvolume group
          </Action>
          <Action icon="mdi:plus" variant="contained" onClick={openCreateFs} reason={canCreate ? null : 'Your role does not allow creating file systems'}>
            Create file system
          </Action>
        </>
      }
    >
      <CsiNotice />
      {nothing ? (
        <Panel>
          <Empty
            icon="mdi:folder-network-outline"
            title="No file system yet"
            action={
              <Action icon="mdi:plus" variant="contained" onClick={openCreateFs} reason={canCreate ? null : 'Your role does not allow creating file systems'}>
                Create file system
              </Action>
            }
          >
            A CephFS file system is shared storage many pods can mount read-write at once (ReadWriteMany), with quotas per directory tree. Rook runs its metadata
            servers and creates its pools.
          </Empty>
        </Panel>
      ) : (
        <Band>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Box component="h2" sx={{ m: 0, fontSize: 18, fontWeight: 650 }}>
              {plural(names.length, 'file system')}
            </Box>
            <Box sx={{ color: t.basaltMuted, fontSize: 13.5 }}>
              {ceph.phase === 'ready' && live.map
                ? `${plural(live.filesystems.reduce((n, f) => n + f.ranks.filter(r => r.state === 'active').length, 0), 'active MDS', 'active MDS')}, ${plural(
                    live.map.standbys.length,
                    'standby',
                    'standbys'
                  )}, ${plural(live.filesystems.reduce((n, f) => n + (f.clients ?? 0), 0), 'client')}`
                : ceph.phase === 'ready'
                ? 'Reading the file system map…'
                : 'Live MDS state needs the Ceph bridge.'}
            </Box>
          </Box>
          <Box sx={{ display: 'grid', gap: 1.25 }}>
            {names.map(n => (
              <Stratum key={n} name={n} cr={crs.find(c => c.metadata.name === n)} fs={live.filesystems.find(f => f.name === n)} live={live} vols={vols.filter(v => v.fsName === n)} />
            ))}
          </Box>
          {live.error && <Box sx={{ mt: 1.5, fontSize: 13, color: t.basaltMuted }}>Ceph did not answer fs dump: {live.error}</Box>}
        </Band>
      )}

      {(!nothing || svgs.length > 0) && (
      <Panel
        title="Subvolume groups"
        icon="mdi:folder-multiple-outline"
        dense
        actions={
          crs.length ? (
            <Action icon="mdi:plus" onClick={() => openCreateSvg()} reason={canSvg ? null : 'Your role does not allow creating subvolume groups'}>
              Create group
            </Action>
          ) : undefined
        }
      >
        <DataTable
          label="Subvolume groups"
          rows={svgs}
          columns={svgCols}
          rowKey={g => g.metadata.name}
          onOpen={g => nav.go('cephfs', g.spec?.filesystemName)}
          empty={
            <Empty icon="mdi:folder-multiple-outline" title="No subvolume group resources">
              Rook creates the csi group Ceph-CSI uses by default. Add groups for separate quotas, data pools or MDS pinning.
            </Empty>
          }
        />
      </Panel>
      )}

      {(!nothing || vols.length > 0) && <VolumesPanel vols={vols} />}
    </Page>
  );
}

/** One file system as a stratum on the band: name and state, rank stones, standbys, figures. */
function Stratum({ name, cr, fs, live, vols }: { name: string; cr?: Obj; fs?: CephFs; live: ReturnType<typeof useFsMap>; vols: FsVolume[] }) {
  const t = useTokens();
  const ceph = useCeph();
  const st = fs ? fsState(fs) : null;
  const standbys = fs && live.map ? standbysFor(fs, live.map) : [];
  const pools = fs ? [fs.metadataPool, ...fs.dataPools].map(id => ceph.core.pools.find(p => p.id === id)).filter(Boolean) : [];
  const stored = pools.reduce((n, p) => n + (p?.usage?.stored ?? 0), 0);
  const expected = cr ? rookFsPools(cr) : null;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(200px, 1fr) minmax(0, 2.4fr) minmax(240px, 1fr)' },
        gap: 2,
        alignItems: 'center',
        p: 1.5,
        borderRadius: `${t.radius.panel}px`,
        border: `1px solid ${t.basaltEdge}`,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Go to={hrefFor('cephfs', name)} sx={{ fontSize: 16, fontWeight: 650 }}>
          {name}
        </Go>
        <Box sx={{ mt: 0.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          {st ? (
            <StateLabel tone={st.tone} title={st.detail}>
              {st.word}
            </StateLabel>
          ) : cr ? (
            <StateLabel tone={ceph.phase === 'ready' && live.map ? 'move' : 'idle'}>{ceph.phase === 'ready' && live.map ? `Rook: ${cr.status?.phase ?? 'creating'}` : cr.status?.phase ?? 'Unknown'}</StateLabel>
          ) : null}
          {!cr && <Box sx={{ fontSize: 12.5, color: t.basaltMuted }}>Not managed by Rook</Box>}
        </Box>
        {st && st.tone !== 'ok' && <Box sx={{ fontSize: 12.5, color: t.basaltMuted, mt: 0.5 }}>{st.detail}</Box>}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'stretch', minWidth: 0 }}>
        {fs ? (
          <>
            {fs.ranks.map(r => (
              <RankStone key={r.rank} rank={r} />
            ))}
            {[...fs.replay, ...standbys].map(d => (
              <StandbyStone key={d.gid || d.name} d={d} />
            ))}
            {!fs.replay.length && !standbys.length && <Box sx={{ alignSelf: 'center', fontSize: 12.5, color: t.basaltMuted }}>No standby MDS: a failure stops the file system until Kubernetes restarts the pod.</Box>}
          </>
        ) : (
          <Box sx={{ fontSize: 13, color: t.basaltMuted }}>
            {ceph.phase !== 'ready'
              ? 'MDS state needs the Ceph bridge.'
              : live.map
              ? `Ceph has no file system ${name} yet: Rook is creating ${expected ? [expected.metadata, ...expected.data].join(', ') : 'its pools'} and the MDS.`
              : 'Reading…'}
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5 }}>
        <BandFigure value={fs?.clients !== undefined ? count(fs.clients) : '—'} label="clients" />
        <BandFigure value={fs ? bytes(stored) : '—'} label="stored" />
        <BandFigure value={count(vols.length)} label={vols.length === 1 ? 'volume' : 'volumes'} />
      </Box>
    </Box>
  );
}

export function VolumesPanel({ vols, title = 'Kubernetes volumes', fsColumn = true }: { vols: FsVolume[]; title?: string; fsColumn?: boolean }) {
  const cols: Column<FsVolume>[] = [
    { id: 'pv', header: 'Volume', cell: v => <Mono>{v.pv.metadata.name}</Mono>, sort: v => v.pv.metadata.name },
    { id: 'claim', header: 'Claim', cell: v => (v.claim ? <Mono>{v.claim}</Mono> : 'Not bound'), sort: v => v.claim },
    ...(fsColumn ? [{ id: 'fs', header: 'File system', cell: (v: FsVolume) => <Go to={hrefFor('cephfs', v.fsName)}>{v.fsName}</Go>, sort: (v: FsVolume) => v.fsName }] : []),
    { id: 'group', header: 'Group', cell: v => (v.group ? <Mono>{v.group}</Mono> : '—'), sort: v => v.group, minWidth: 900 },
    { id: 'sub', header: 'Subvolume', cell: v => (v.static ? 'Static' : <Mono>{v.subvolume}</Mono>), sort: v => v.subvolume, minWidth: 1000 },
    { id: 'size', header: 'Size', align: 'right', cell: v => v.pv.spec?.capacity?.storage ?? '—', sort: v => String(v.pv.spec?.capacity?.storage ?? '') },
    { id: 'phase', header: 'State', cell: v => <PhaseLabel phase={v.pv.status?.phase} />, sort: v => v.pv.status?.phase ?? '' },
  ];
  return (
    <Panel title={title} icon="mdi:harddisk" dense>
      <DataTable
        label={title}
        rows={vols}
        columns={cols}
        rowKey={v => v.pv.metadata.name}
        empty={
          <Empty icon="mdi:harddisk" title="No CephFS volume in Kubernetes">
            Volumes appear here once a StorageClass with the CephFS CSI driver provisions them; each one is a subvolume.
          </Empty>
        }
      />
    </Panel>
  );
}
