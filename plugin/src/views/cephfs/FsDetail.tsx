/*
 * One file system: ranks and MDS on the band, pools, the Rook resource,
 * MDS pods, subvolume groups and subvolumes mapped to Kubernetes volumes.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { deleteFilesystem, deleteSubvolumeGroup, fsBlockers, svgBlockers } from '../../api/fsOps';
import { useKube } from '../../api/kube';
import { rookAttrs, useCan } from '../../api/permissions';
import {
  cephfsVolumes,
  fsState,
  fsStorageClasses,
  NO_GROUP,
  pinningWord,
  rookFsPools,
  standbysFor,
  Subvolume,
  svgGroupName,
} from '../../model/cephfs';
import { bytes, count, pct, plural } from '../../model/format';
import { Obj } from '../../model/types';
import { LiveGate } from '../../shell/Gate';
import { poolHref, useNav } from '../../shell/nav';
import { Column, DataTable } from '../../ui/DataTable';
import { confirm } from '../../ui/dialogs';
import { Action, Band, Empty, Figure, Grid, IconAction, KV, Meter, MiniBar, Mono, Notice, Page, Panel, Tag, ToolButton, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { CsiNotice, VolumesPanel } from './CephFsView';
import { Conditions, PhaseLabel, PodList } from './formkit';
import { openCreateSvg } from './fsDialogs';
import { Go, GroupRow, RankStone, StandbyStone, useFsGroups, useFsMap } from './fsParts';

export function FsDetail({ name }: { name: string }) {
  const kube = useKube();
  const ceph = useCeph();
  const nav = useNav();
  const t = useTokens();
  const live = useFsMap();
  const cr = kube.filesystems.items.find(x => x.metadata.namespace === kube.ns && x.metadata.name === name);
  const fs = live.filesystems.find(f => f.name === name);
  const groups = useFsGroups(name, !!fs);
  const canDelete = useCan(rookAttrs('delete', 'cephfilesystems', kube.ns));
  const canSvg = useCan(rookAttrs('create', 'cephfilesystemsubvolumegroups', kube.ns));
  const canDelSvg = useCan(rookAttrs('delete', 'cephfilesystemsubvolumegroups', kube.ns));
  const svgs = kube.subVolumeGroups.items.filter(x => x.metadata.namespace === kube.ns && x.spec?.filesystemName === name);
  const vols = cephfsVolumes(kube.pvs.items, name);
  const pods = kube.rookPods.items.filter(p => p.metadata.labels?.app === 'rook-ceph-mds' && p.metadata.labels?.rook_file_system === name);
  const scs = fsStorageClasses(kube.storageClasses.items, name);

  const known = !!cr || !!fs;
  const stillLoading = !kube.filesystems.loaded || (ceph.phase === 'ready' && !live.map);
  if (!known && !stillLoading)
    return (
      <Page title={name}>
        <Panel>
          <Empty
            icon="mdi:folder-question-outline"
            title={`No file system named ${name}`}
            action={
              <Action icon="mdi:arrow-left" onClick={() => nav.go('cephfs')}>
                All file systems
              </Action>
            }
          >
            Neither Rook nor Ceph knows it. It may have been deleted.
          </Empty>
        </Panel>
      </Page>
    );

  const st = fs ? fsState(fs) : null;
  const standbys = fs && live.map ? standbysFor(fs, live.map) : [];
  const deleting = !!cr?.metadata.deletionTimestamp;

  const onDelete = () => {
    if (!cr) return;
    const why = fsBlockers(cr, kube.pvs.items, kube.subVolumeGroups.items.filter(x => x.metadata.namespace === kube.ns), kube.nfs.items);
    if (why.length) {
      confirm({
        infoOnly: true,
        title: `${name} cannot be deleted yet`,
        consequences: why,
        footer: 'Delete what depends on it first, then come back: the delete preview lists what happens to the data.',
      });
      return;
    }
    deleteFilesystem(cr, { pvs: kube.pvs.items, onDone: () => nav.go('cephfs') });
  };

  return (
    <Page
      title={name}
      subtitle="A CephFS file system: its ranks and metadata servers, pools, subvolume groups and the Kubernetes volumes in it."
      actions={
        <>
          <ToolButton icon="mdi:arrow-left" onClick={() => nav.go('cephfs')}>
            All file systems
          </ToolButton>
          <Action icon="mdi:folder-plus-outline" onClick={() => openCreateSvg(name)} reason={!cr ? 'Only file systems Rook manages get subvolume group resources' : canSvg ? null : 'Your role does not allow creating subvolume groups'}>
            Create subvolume group
          </Action>
          <Action
            icon="mdi:delete-outline"
            color="error"
            onClick={onDelete}
            reason={!cr ? 'Rook does not manage this file system' : deleting ? 'Rook is deleting it' : canDelete ? null : 'Your role does not allow deleting file systems'}
          >
            Delete file system
          </Action>
        </>
      }
    >
      <CsiNotice />
      {deleting && (
        <Notice tone="move" title="Rook is deleting this file system">
          The resource has a deletion time{cr?.status?.phase ? ` (phase ${cr.status.phase})` : ''}. Rook removes it once nothing depends on it.
        </Notice>
      )}

      <Band>
        <LiveGate compact>
          {fs ? (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                {st && (
                  <Box sx={{ fontSize: 18, fontWeight: 650 }}>
                    <StateLabel tone={st.tone}>
                      <Box component="span" sx={{ fontSize: 18 }}>
                        {st.word}
                      </Box>
                    </StateLabel>
                  </Box>
                )}
                <Box sx={{ color: t.basaltMuted, fontSize: 13.5, flex: 1, minWidth: 200 }}>{st?.detail}</Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
                {fs.ranks.map(r => (
                  <RankStone key={r.rank} rank={r} large />
                ))}
                {[...fs.replay, ...standbys].map(d => (
                  <StandbyStone key={d.gid || d.name} d={d} />
                ))}
              </Box>
              {!fs.replay.length && !standbys.length && (
                <Box sx={{ fontSize: 13, color: t.basaltMuted }}>No standby MDS: if the active one fails, clients wait until Kubernetes restarts it.</Box>
              )}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 2, pt: 1.5, borderTop: `1px solid ${t.basaltEdge}` }}>
                <Figure onBand value={count(fs.clients ?? 0)} label="client sessions" />
                <Figure onBand value={`${fs.ranks.filter(r => r.state === 'active').length} of ${fs.maxMds}`} label="active of max MDS" />
                <Figure onBand value={count(standbys.length + fs.replay.length)} label={`standby (wanted ${fs.standbyWanted})`} />
                <Figure onBand value={fs.allowStandbyReplay ? 'On' : 'Off'} label="standby-replay" />
                <Figure onBand value={count(groups.total)} label="subvolumes" />
                <Figure onBand value={count(fs.epoch)} label="MDS map epoch" />
              </Box>
            </Box>
          ) : (
            <Box sx={{ fontSize: 14 }}>
              {live.map ? (
                <>
                  <Box sx={{ fontWeight: 600, mb: 0.5 }}>Ceph has no file system {name} yet</Box>
                  <Box sx={{ color: t.basaltMuted }}>
                    Rook creates its pools ({cr ? [rookFsPools(cr).metadata, ...rookFsPools(cr).data].join(', ') : '—'}) and then the file system; MDS pods start after that.
                    Rook phase: {cr?.status?.phase ?? 'not reported yet'}.
                  </Box>
                </>
              ) : (
                'Reading the file system map…'
              )}
            </Box>
          )}
        </LiveGate>
      </Band>

      <Grid min={340}>
        <PoolsPanel fsPools={fs ? { metadata: fs.metadataPool, data: fs.dataPools } : null} cr={cr} />
        <Panel title="Rook resource" icon="mdi:file-cog-outline">
          {cr ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <KV
                labelWidth={170}
                rows={[
                  ['State', <PhaseLabel key="p" phase={cr.status?.phase} />],
                  ['Active MDS', cr.spec?.metadataServer?.activeCount ?? 1],
                  ['Standby-replay', cr.spec?.metadataServer?.activeStandby ? 'Yes' : 'No'],
                  ['MDS resources', resWords(cr.spec?.metadataServer?.resources)],
                  ['On delete', cr.spec?.preserveFilesystemOnDelete ? 'Keep the file system' : cr.spec?.preservePoolsOnDelete ? 'Keep the pools' : 'Delete everything'],
                  ['Created', <When key="c" at={cr.metadata.creationTimestamp} />],
                ]}
              />
              <Conditions cr={cr} />
            </Box>
          ) : (
            <Box sx={{ fontSize: 13.5, color: t.muted }}>No CephFilesystem resource: this file system was made outside Rook, and Cairn shows it read-only.</Box>
          )}
        </Panel>
        <Panel title="MDS pods" icon="mdi:server-network">
          <PodList pods={pods} empty={cr ? 'No MDS pod yet: Rook starts them after the file system exists.' : 'No Rook MDS pod for this file system.'} />
        </Panel>
      </Grid>

      <GroupsPanel name={name} groups={groups} svgs={svgs} canCreate={!!cr && canSvg} canDelete={canDelSvg} />
      <SubvolumesPanel groups={groups} vols={vols} />
      <VolumesPanel vols={vols} title="Kubernetes volumes on it" fsColumn={false} />
      {scs.length > 0 && (
        <Panel title="StorageClasses" icon="mdi:layers-outline">
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {scs.map(sc => (
              <Tag key={sc.metadata.name}>
                <Mono>{sc.metadata.name}</Mono>
              </Tag>
            ))}
          </Box>
        </Panel>
      )}
    </Page>
  );
}

function resWords(r: any): string {
  if (!r) return 'Not set (no limit)';
  const parts = [];
  if (r.requests?.cpu) parts.push(`${r.requests.cpu} CPU`);
  if (r.requests?.memory) parts.push(`${r.requests.memory} memory`);
  const req = parts.length ? `asks ${parts.join(', ')}` : '';
  const lim = r.limits?.memory ? `limit ${r.limits.memory}` : r.limits?.cpu ? `limit ${r.limits.cpu} CPU` : '';
  return [req, lim].filter(Boolean).join('; ') || 'Not set';
}

function PoolsPanel({ fsPools, cr }: { fsPools: { metadata: number; data: number[] } | null; cr?: Obj }) {
  const ceph = useCeph();
  const t = useTokens();
  const ids = fsPools ? [fsPools.metadata, ...fsPools.data] : [];
  const rows = ids.map((id, i) => ({ id, role: i === 0 ? 'Metadata' : i === 1 ? 'Default data' : 'Data', pool: ceph.core.pools.find(p => p.id === id) }));
  return (
    <Panel title="Pools" icon="mdi:database-outline">
      <LiveGate compact>
        {rows.length ? (
          <Box sx={{ display: 'grid', gap: 1.75 }}>
            {rows.map(r => {
              const u = r.pool?.usage;
              return (
                <Box key={r.id}>
                  <Meter
                    label={
                      <>
                        {r.pool ? <Go to={poolHref(r.pool.name)}>{r.pool.name}</Go> : `pool ${r.id}`}{' '}
                        <Box component="span" sx={{ color: t.muted, fontWeight: 400 }}>
                          {r.role}
                        </Box>
                      </>
                    }
                    used={u?.stored}
                    total={(u?.stored ?? 0) + (u?.maxAvail ?? 0)}
                    format={bytes}
                    caption={
                      r.pool
                        ? `${r.pool.type === 'erasure' && r.pool.ec ? `Erasure ${r.pool.ec.k}+${r.pool.ec.m}` : `${r.pool.size} replicas`}, ${count(u?.objects ?? 0)} objects${
                            u ? `, ${pct(u.percentUsed)} of what it can take` : ''
                          }`
                        : undefined
                    }
                  />
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ fontSize: 13.5, color: t.muted }}>{cr ? `Rook creates ${[rookFsPools(cr).metadata, ...rookFsPools(cr).data].join(', ')}.` : 'No pool known.'}</Box>
        )}
      </LiveGate>
    </Panel>
  );
}

interface MergedGroup {
  name: string;
  row?: GroupRow;
  cr?: Obj;
}

function GroupsPanel({
  name,
  groups,
  svgs,
  canCreate,
  canDelete,
}: {
  name: string;
  groups: ReturnType<typeof useFsGroups>;
  svgs: Obj[];
  canCreate: boolean;
  canDelete: boolean;
}) {
  const kube = useKube();
  const merged: MergedGroup[] = [...new Set([...groups.groups.map(g => g.name), ...svgs.map(svgGroupName)])]
    .sort()
    .map(g => ({ name: g, row: groups.groups.find(x => x.name === g), cr: svgs.find(s => svgGroupName(s) === g) }));
  const cols: Column<MergedGroup>[] = [
    { id: 'name', header: 'Group', cell: g => <Mono>{g.name}</Mono>, sort: g => g.name },
    {
      id: 'cr',
      header: 'Managed by',
      cell: g => (g.cr ? <Mono>{g.cr.metadata.name}</Mono> : g.name === 'csi' ? 'Rook (Ceph-CSI default)' : 'Ceph only'),
      sort: g => (g.cr ? g.cr.metadata.name : ''),
    },
    { id: 'state', header: 'State', cell: g => (g.cr ? <PhaseLabel phase={g.cr.status?.phase} /> : g.row ? <StateLabel tone="ok">In Ceph</StateLabel> : '—'), minWidth: 800 },
    {
      id: 'used',
      header: 'Used',
      align: 'right',
      cell: g => (g.row?.usedBytes !== null && g.row?.usedBytes !== undefined ? bytes(g.row.usedBytes) : '—'),
      sort: g => g.row?.usedBytes ?? -1,
    },
    { id: 'quota', header: 'Quota', align: 'right', cell: g => (g.row?.quotaBytes ? bytes(g.row.quotaBytes) : g.cr?.spec?.quota ?? 'None'), sort: g => g.row?.quotaBytes ?? 0 },
    { id: 'subs', header: 'Subvolumes', align: 'right', cell: g => (g.row ? count(g.row.subvolumes.length) : '—'), sort: g => g.row?.subvolumes.length ?? 0 },
    { id: 'pool', header: 'Data pool', cell: g => (g.row?.dataPool ? <Go to={poolHref(g.row.dataPool)}>{g.row.dataPool}</Go> : '—'), minWidth: 1000 },
    { id: 'pin', header: 'Pinning', cell: g => (g.cr ? pinningWord(g.cr) : '—'), minWidth: 1100 },
    {
      id: 'act',
      header: '',
      align: 'right',
      width: 48,
      cell: g =>
        g.cr ? (
          <IconAction
            icon="mdi:delete-outline"
            label={canDelete ? `Delete ${g.cr.metadata.name}` : 'Your role does not allow deleting subvolume groups'}
            disabled={!canDelete || !!g.cr.metadata.deletionTimestamp}
            onClick={() => {
              const why = svgBlockers(g.cr as Obj, kube.pvs.items, g.row ? g.row.subvolumes : null);
              if (why.length) {
                confirm({
                  infoOnly: true,
                  title: `${g.name} is not empty`,
                  consequences: why,
                  footer: `Delete the claims of the Kubernetes volumes in it first; Ceph-CSI then removes their subvolumes. Subvolumes made by hand go with: ceph fs subvolume rm ${name} <subvolume> --group_name ${g.name}.`,
                });
                return;
              }
              deleteSubvolumeGroup(g.cr as Obj, {});
            }}
          />
        ) : null,
    },
  ];
  return (
    <Panel
      title="Subvolume groups"
      icon="mdi:folder-multiple-outline"
      dense
      actions={
        <Action icon="mdi:plus" onClick={() => openCreateSvg(name)} reason={canCreate ? null : 'Create needs a Rook-managed file system and the right role'}>
          Create group
        </Action>
      }
    >
      <LiveGate compact>
        {groups.error && (
          <Box sx={{ p: 1.5 }}>
            <Notice tone="err" title="Ceph did not list the groups">
              {groups.error}
            </Notice>
          </Box>
        )}
        <DataTable
          label="Subvolume groups"
          rows={merged}
          columns={cols}
          rowKey={g => g.name}
          empty={
            <Empty icon="mdi:folder-multiple-outline" title={groups.loading ? 'Reading the groups…' : 'No subvolume group'}>
              Ceph-CSI puts volumes in the csi group, which Rook creates. Add a group for a separate quota, data pool or pinning.
            </Empty>
          }
        />
      </LiveGate>
    </Panel>
  );
}

function SubvolumesPanel({ groups, vols }: { groups: ReturnType<typeof useFsGroups>; vols: ReturnType<typeof cephfsVolumes> }) {
  const t = useTokens();
  const pvOf = (s: Subvolume) => vols.find(v => v.subvolume === s.name && (!v.group || v.group === s.group));
  const cols: Column<Subvolume>[] = [
    { id: 'name', header: 'Subvolume', cell: s => <Mono>{s.name}</Mono>, sort: s => s.name },
    { id: 'group', header: 'Group', cell: s => <Mono muted={s.group === NO_GROUP}>{s.group === NO_GROUP ? 'no group' : s.group}</Mono>, sort: s => s.group },
    {
      id: 'used',
      header: 'Used',
      align: 'right',
      cell: s =>
        s.error ? (
          <Box component="span" title={s.error} sx={{ color: 'error.main' }}>
            Unreadable
          </Box>
        ) : s.usedBytes === null ? (
          '—'
        ) : (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            {s.quotaBytes ? <MiniBar pct={(s.usedBytes / s.quotaBytes) * 100} width={48} /> : null}
            {bytes(s.usedBytes)}
          </Box>
        ),
      sort: s => s.usedBytes ?? -1,
    },
    { id: 'quota', header: 'Quota', align: 'right', cell: s => (s.quotaBytes ? bytes(s.quotaBytes) : 'None'), sort: s => s.quotaBytes ?? 0 },
    { id: 'state', header: 'State', cell: s => (s.state ? <StateLabel tone={s.state === 'complete' ? 'ok' : s.state === 'pending' ? 'move' : 'warn'}>{s.state}</StateLabel> : '—'), sort: s => s.state },
    {
      id: 'pv',
      header: 'Kubernetes volume',
      cell: s => {
        const v = pvOf(s);
        return v ? <Mono>{v.claim || v.pv.metadata.name}</Mono> : <Box component="span" sx={{ color: t.muted }}>None</Box>;
      },
      sort: s => pvOf(s)?.claim ?? '',
    },
    { id: 'created', header: 'Created', cell: s => <When at={s.created} />, sort: s => s.created ?? 0, minWidth: 900 },
    { id: 'path', header: 'Path', cell: s => <Mono muted>{s.path || '—'}</Mono>, minWidth: 1200, width: 360 },
  ];
  return (
    <Panel title="Subvolumes" icon="mdi:folder-outline" dense>
      <LiveGate compact>
        {groups.truncated && (
          <Box sx={{ p: 1.5 }}>
            <Notice tone="idle">
              Showing the first {groups.subvolumes.length} of {plural(groups.total, 'subvolume')}.
            </Notice>
          </Box>
        )}
        <DataTable
          label="Subvolumes"
          rows={groups.subvolumes}
          columns={cols}
          rowKey={s => `${s.group}/${s.name}`}
          empty={
            <Empty icon="mdi:folder-outline" title={groups.loading ? 'Reading the subvolumes…' : 'No subvolume'}>
              Each CephFS volume Kubernetes provisions is a subvolume with a quota of its size. None exists in this file system.
            </Empty>
          }
        />
      </LiveGate>
    </Panel>
  );
}


