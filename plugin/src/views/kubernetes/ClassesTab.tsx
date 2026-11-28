/*
 * Storage classes backed by Ceph: what each gives in plain words, where
 * its data lives, how many volumes it made and how much they hold; the
 * snapshot classes that serve them. Create a class with the wizard, delete
 * one nobody uses, add the missing snapshot class.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { deleteClass, deleteSnapshotClass, itemsOf, pvList, useKGet } from '../../api/k8sOps';
import { useKube } from '../../api/kube';
import { useCan } from '../../api/permissions';
import { bytes, plural } from '../../model/format';
import {
  ClassRow,
  classRows,
  classUsage,
  isDefaultClass,
  pvLabel,
  pvsOfClass,
  secretParams,
  SnapRow,
  snapshotRows,
  WizardContext,
} from '../../model/storageclass';
import { Obj } from '../../model/types';
import { Loading } from '../../shell/Gate';
import { poolHref } from '../../shell/nav';
import { previewChange } from '../../ui/ChangeDialog';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Band, Empty, IconAction, KV, Mono, Notice, Panel, Tag } from '../../ui/kit';
import { tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { runClassWizard } from './ClassWizard';
import { CLink, yesNo } from './parts';

const STRATA = ['#8FA3AE', '#62788A', '#B5C3CA', '#4F6574', '#A1B2BC', '#788D9A'];

export function ClassesTab() {
  const kube = useKube();
  const ceph = useCeph();
  const t = useTokens();
  const csiObjs = useKGet('/apis/storage.k8s.io/v1/csidrivers', 60000);
  // Both lists are watched: a class created or deleted, here or elsewhere, shows at once.
  const scs = kube.storageClasses.items;
  const vscs = kube.snapshotClasses.items;
  const [selected, setSelected] = React.useState<string | null>(null);
  const canCreate = useCan({ verb: 'create', group: 'storage.k8s.io', resource: 'storageclasses' });
  const canDelete = useCan({ verb: 'delete', group: 'storage.k8s.io', resource: 'storageclasses' });
  const canCreateSnap = useCan({ verb: 'create', group: 'snapshot.storage.k8s.io', resource: 'volumesnapshotclasses' });
  const canDeleteSnap = useCan({ verb: 'delete', group: 'snapshot.storage.k8s.io', resource: 'volumesnapshotclasses' });

  const pvs = kube.pvs.items;
  const { rows, others } = React.useMemo(() => classRows(scs, pvs, vscs), [scs, pvs, vscs]);
  const snaps = React.useMemo(() => snapshotRows(vscs, scs), [vscs, scs]);
  const ctx: WizardContext = {
    ns: kube.ns,
    storageClasses: scs,
    snapshotClasses: vscs,
    drivers: kube.csiDrivers.items,
    csiDrivers: itemsOf(csiObjs),
    filesystems: kube.filesystems.items,
    blockPools: kube.blockPools.items,
  };
  const openWizard = () => runClassWizard(ctx, { cephPools: ceph.core.pools });

  if (!kube.storageClasses.loaded) return <Loading label="Reading StorageClasses…" />;
  if (kube.storageClasses.forbidden)
    return (
      <Notice tone="warn" title="Your role may not list StorageClasses">
        Cairn needs list on storageclasses.storage.k8s.io to show them (the cairn-viewer role has it).
      </Notice>
    );

  const sel = rows.find(r => r.name === selected) ?? null;
  const total = rows.reduce((n, r) => n + r.capacity, 0);
  const volumes = rows.reduce((n, r) => n + r.pvCount, 0);
  const colorOf = new Map(rows.filter(r => r.capacity > 0).map((r, i) => [r.name, STRATA[i % STRATA.length]]));
  const createReason = !canCreate ? 'Your role may not create StorageClasses (create storageclasses.storage.k8s.io)' : null;

  const cols: Column<ClassRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: r => (
        <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
          <Mono>{r.name}</Mono>
          {r.isDefault && <Tag tone="accent">default</Tag>}
        </Box>
      ),
      sort: r => r.name,
    },
    { id: 'gives', header: 'Gives', cell: r => r.words, sort: r => r.words },
    {
      id: 'where',
      header: 'Data in',
      cell: r =>
        r.pool && r.kind === 'rbd' ? (
          <CLink to={poolHref(r.pool)} title={`Pool ${r.pool}`}>
            <Mono>{r.pool}</Mono>
          </CLink>
        ) : r.fsName ? (
          <Mono>{r.fsName}</Mono>
        ) : r.objectStore ? (
          <Mono>{r.objectStore}</Mono>
        ) : (
          '—'
        ),
      sort: r => r.pool ?? r.fsName ?? r.objectStore ?? '',
    },
    { id: 'vols', header: 'Volumes', cell: r => r.pvCount, sort: r => r.pvCount, align: 'right' },
    { id: 'cap', header: 'Capacity', cell: r => (r.pvCount ? bytes(r.capacity) : '—'), sort: r => r.capacity, align: 'right' },
    { id: 'reclaim', header: 'On delete', cell: r => (r.reclaim === 'Retain' ? 'Keep data' : 'Delete data'), sort: r => r.reclaim, minWidth: 900 },
    { id: 'bind', header: 'Made', cell: r => (r.binding === 'WaitForFirstConsumer' ? 'On first use' : 'At once'), sort: r => r.binding, minWidth: 1000 },
    { id: 'grow', header: 'Can grow', cell: r => yesNo(r.expansion), sort: r => String(r.expansion), minWidth: 1000 },
    { id: 'snap', header: 'Snapshot class', cell: r => (r.snapshotClasses.length ? <Mono>{r.snapshotClasses.join(', ')}</Mono> : 'None'), minWidth: 1150 },
    { id: 'cid', header: 'Cluster ID', cell: r => <Mono muted>{r.clusterID ?? '—'}</Mono>, minWidth: 1350 },
  ];

  return (
    <>
      <Band>
        <Box sx={{ display: 'flex', gap: { xs: 3, md: 5 }, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <BandFigure value={rows.length} label={rows.length === 1 ? 'Ceph storage class' : 'Ceph storage classes'} />
          <BandFigure value={volumes} label={volumes === 1 ? 'volume' : 'volumes'} />
          <BandFigure value={bytes(total)} label="provisioned" />
          <BandFigure value={snaps.length} label={snaps.length === 1 ? 'snapshot class' : 'snapshot classes'} />
        </Box>
        {rows.length > 0 && (
          <Box sx={{ mt: 2.5 }}>
            <Box
              role="img"
              aria-label={`Provisioned capacity by class: ${rows.map(r => `${r.name} ${bytes(r.capacity)}`).join(', ')}`}
              sx={{ display: 'flex', height: 14, borderRadius: '3px', overflow: 'hidden', background: 'rgba(255,255,255,0.06)', gap: '2px' }}
            >
              {total > 0 &&
                rows
                  .filter(r => r.capacity > 0)
                  .map(r => (
                    <Box key={r.name} title={`${r.name}: ${bytes(r.capacity)}`} sx={{ flex: `${r.capacity} 1 0`, minWidth: 4, background: colorOf.get(r.name) }} />
                  ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', mt: 1 }}>
              {rows.map(r => (
                <Box key={r.name} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 13, color: t.basaltMuted, ...tabular }}>
                  <Box
                    component="span"
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '2px',
                      background: colorOf.get(r.name) ?? 'transparent',
                      border: colorOf.has(r.name) ? 'none' : `1px solid ${t.basaltMuted}`,
                    }}
                  />
                  <Box component="span" sx={{ color: t.basaltText, fontFamily: t.font.mono, fontSize: 12.5 }}>
                    {r.name}
                  </Box>
                  {plural(r.pvCount, 'volume')}, {bytes(r.capacity)}
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Band>

      <Panel
        title="Storage classes backed by Ceph"
        icon="mdi:layers-outline"
        dense
        actions={
          <Action icon="mdi:plus" variant="contained" onClick={openWizard} reason={createReason}>
            Create StorageClass
          </Action>
        }
        footer={
          others.length > 0 ? (
            <Typography sx={{ fontSize: 12.5, color: t.muted }}>
              Not backed by Ceph: {others.map(o => `${o.metadata.name} (${o.provisioner}${isDefaultClass(o) ? ', default' : ''})`).join(', ')}.
            </Typography>
          ) : undefined
        }
      >
        <DataTable
          label="Ceph storage classes"
          rows={rows}
          columns={cols}
          rowKey={r => r.name}
          onOpen={r => setSelected(s => (s === r.name ? null : r.name))}
          activeKey={sel?.name}
          empty={
            <Empty
              icon="mdi:layers-off-outline"
              title="No StorageClass uses Ceph yet"
              action={
                <Action icon="mdi:plus" onClick={openWizard} reason={createReason}>
                  Create StorageClass
                </Action>
              }
            >
              Kubernetes claims volumes through a StorageClass. Make one from a pool: disks for virtual machines, filesystem volumes, or a shared filesystem.
            </Empty>
          }
        />
      </Panel>

      {sel && (
        <ClassDetail
          row={sel}
          pvcs={kube.pvcs.items}
          pvs={pvs}
          snaps={snaps}
          canDelete={canDelete}
          canCreateSnap={canCreateSnap}
          onDeleted={() => setSelected(null)}
          onClose={() => setSelected(null)}
        />
      )}
      {!sel && rows.length > 0 && <Typography sx={{ fontSize: 13, color: t.muted, mt: -1 }}>Select a class to see its parameters, its volumes and its snapshot classes.</Typography>}

      <SnapshotClasses rows={snaps} canDelete={canDeleteSnap} />
    </>
  );
}

function BandFigure({ value, label }: { value: React.ReactNode; label: string }) {
  const t = useTokens();
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15, color: t.basaltText, ...tabular }}>{value}</Typography>
      <Typography sx={{ fontSize: 13, color: t.basaltMuted }}>{label}</Typography>
    </Box>
  );
}

function ClassDetail({
  row,
  pvs,
  pvcs,
  snaps,
  canDelete,
  canCreateSnap,
  onDeleted,
  onClose,
}: {
  row: ClassRow;
  pvs: Obj[];
  pvcs: Obj[];
  snaps: SnapRow[];
  canDelete: boolean;
  canCreateSnap: boolean;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const t = useTokens();
  const usage = classUsage(row.name, pvs, pvcs);
  const mine = pvsOfClass(row.name, pvs);
  const secrets = secretParams(row.obj);
  const deleteReason = !canDelete
    ? 'Your role may not delete StorageClasses'
    : usage.pvs.length
    ? `${plural(usage.pvs.length, 'volume')} still use${usage.pvs.length === 1 ? 's' : ''} it: ${pvList(usage.pvs)}. Delete or move them first.`
    : null;
  const serving = snaps.filter(s => row.snapshotClasses.includes(s.name));
  const addSnapshotClass = () => {
    const p = row.obj.parameters ?? {};
    const vsc: Obj = {
      apiVersion: 'snapshot.storage.k8s.io/v1',
      kind: 'VolumeSnapshotClass',
      metadata: { name: `${row.name}-snapshot` },
      driver: row.provisioner,
      parameters: {
        clusterID: row.clusterID ?? '',
        'csi.storage.k8s.io/snapshotter-secret-name': p['csi.storage.k8s.io/provisioner-secret-name'] ?? (row.kind === 'cephfs' ? 'rook-csi-cephfs-provisioner' : 'rook-csi-rbd-provisioner'),
        'csi.storage.k8s.io/snapshotter-secret-namespace': p['csi.storage.k8s.io/provisioner-secret-namespace'] ?? row.clusterID ?? '',
      },
      deletionPolicy: 'Delete',
    };
    previewChange({
      title: `Create VolumeSnapshotClass ${vsc.metadata.name}`,
      op: 'create',
      after: vsc,
      action: 'Create snapshot class',
      consequences: [`VolumeSnapshots of ${row.name} volumes can name it; each is a Ceph snapshot made by ${row.provisioner}.`],
      target: `volumesnapshotclass ${vsc.metadata.name}`,
    });
  };
  return (
    <Panel
      title={
        <>
          <Mono>{row.name}</Mono>
          <Box component="span" sx={{ color: t.muted, fontWeight: 400, ml: 1, fontSize: 13.5 }}>
            {row.words}
          </Box>
        </>
      }
      icon="mdi:layers-outline"
      actions={
        <>
          {!serving.length && (row.kind === 'rbd' || row.kind === 'cephfs') && (
            <Action icon="mdi:camera-plus-outline" onClick={addSnapshotClass} reason={canCreateSnap ? null : 'Your role may not create VolumeSnapshotClasses'}>
              Add snapshot class
            </Action>
          )}
          <Action
            icon="mdi:delete-outline"
            color="error"
            reason={deleteReason}
            onClick={() => deleteClass(row.obj, usage.pending, () => onDeleted())}
          >
            Delete StorageClass
          </Action>
          <IconAction icon="mdi:close" label="Close" onClick={onClose} />
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.1fr) minmax(0, 1fr)' } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {row.description && <Typography sx={{ fontSize: 13.5 }}>{row.description}</Typography>}
          <KV
            labelWidth={170}
            rows={[
              ['Provisioner', <Mono key="p">{row.provisioner}</Mono>],
              ['Cluster ID', <Mono key="c">{row.clusterID ?? '—'}</Mono>],
              !!row.pool && [
                row.kind === 'cephfs' ? 'Data pool' : 'Pool',
                row.kind === 'rbd' ? (
                  <CLink key="pool" to={poolHref(row.pool)}>
                    <Mono>{row.pool}</Mono>
                  </CLink>
                ) : (
                  <Mono key="pool">{row.pool}</Mono>
                ),
              ],
              !!row.dataPool && ['Data pool (erasure coded)', <CLink key="dp" to={poolHref(row.dataPool)}><Mono>{row.dataPool}</Mono></CLink>],
              !!row.radosNamespace && ['RADOS namespace', <Mono key="rn">{row.radosNamespace}</Mono>],
              !!row.fsName && ['Filesystem', <Mono key="fs">{row.fsName}</Mono>],
              !!row.objectStore && ['Object store', <Mono key="os">{row.objectStore}</Mono>],
              row.kind === 'rbd' && [
                'Image features',
                <Box key="f" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {row.imageFeatures.length ? row.imageFeatures.map(f => <Tag key={f}>{f}</Tag>) : 'Ceph’s defaults'}
                </Box>,
              ],
              !!row.mapOptions && ['Map options', <Mono key="m">{row.mapOptions}</Mono>],
              !!row.mounter && ['Mounter', <Mono key="mt">{row.mounter}</Mono>],
              (row.kind === 'rbd' || !!row.fstype) && ['Filesystem type', row.fstype ?? '—'],
              ['When a claim is deleted', row.reclaim === 'Retain' ? 'Keep the data in Ceph (Retain)' : 'Delete the data in Ceph (Delete)'],
              ['When the volume is made', row.binding === 'WaitForFirstConsumer' ? 'When a pod first uses it' : 'As soon as it is claimed'],
              ['Claims can grow', yesNo(row.expansion)],
              ['Default class', yesNo(row.isDefault)],
              !!row.preset && ['Made by Cairn as', row.preset === 'vm' ? 'Disks for virtual machines' : row.preset === 'fs' ? 'Filesystem volumes' : 'Shared filesystem'],
            ]}
          />
          {Object.keys(secrets).length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>CSI secrets (names)</Typography>
              <KV
                labelWidth={240}
                rows={Object.entries(secrets)
                  .filter(([k]) => k.endsWith('-name'))
                  .map(([k, v]) => {
                    const nsKey = k.replace(/-name$/, '-namespace');
                    return [k.replace('csi.storage.k8s.io/', '').replace(/-secret-name$/, ''), <Mono key={k}>{`${secrets[nsKey] ? `${secrets[nsKey]}/` : ''}${v}`}</Mono>];
                  })}
              />
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.75 }}>
              {mine.length ? `${plural(mine.length, 'volume')}, ${bytes(row.capacity)}` : 'No volumes'}
              {row.blockVolumes > 0 && row.fsVolumes > 0 && (
                <Box component="span" sx={{ fontWeight: 400, color: t.muted }}>
                  {' '}
                  ({row.blockVolumes} block, {row.fsVolumes} filesystem)
                </Box>
              )}
            </Typography>
            {mine.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: t.muted }}>No claim uses this class yet{usage.pending.length ? `; ${plural(usage.pending.length, 'claim')} waiting` : ''}.</Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', fontSize: 13, maxHeight: 260, overflow: 'auto' }}>
                {mine.slice(0, 50).map(pv => (
                  <Box component="li" key={pv.metadata.name} sx={{ display: 'flex', gap: 1, py: 0.4, borderBottom: `1px solid ${t.rule}`, ...tabular }}>
                    <Mono>{pvLabel(pv)}</Mono>
                    <Box sx={{ flex: 1 }} />
                    <Box component="span" sx={{ color: t.muted }}>
                      {pv.spec?.volumeMode === 'Block' ? 'Block' : 'Filesystem'}, {pv.spec?.capacity?.storage}
                    </Box>
                  </Box>
                ))}
                {mine.length > 50 && <Box component="li" sx={{ color: t.muted, pt: 0.5 }}>and {mine.length - 50} more (Volumes tab)</Box>}
              </Box>
            )}
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.5 }}>Snapshot classes</Typography>
            {serving.length ? (
              serving.map(s => (
                <Typography key={s.name} sx={{ fontSize: 13 }}>
                  <Mono>{s.name}</Mono>
                  <Box component="span" sx={{ color: t.muted }}>
                    {' '}
                    {s.deletionPolicy === 'Delete' ? 'deletes Ceph snapshots with the VolumeSnapshot' : 'keeps Ceph snapshots'}
                    {s.isDefault ? ', default' : ''}
                  </Box>
                </Typography>
              ))
            ) : (
              <Typography sx={{ fontSize: 13, color: t.muted }}>None: VolumeSnapshots of these volumes cannot be taken until one exists.</Typography>
            )}
          </Box>
        </Box>
      </Box>
    </Panel>
  );
}

function SnapshotClasses({ rows, canDelete }: { rows: SnapRow[]; canDelete: boolean }) {
  const cols: Column<SnapRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: r => (
        <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
          <Mono>{r.name}</Mono>
          {r.isDefault && <Tag tone="accent">default</Tag>}
        </Box>
      ),
      sort: r => r.name,
    },
    { id: 'driver', header: 'Driver', cell: r => <Mono>{r.driver}</Mono>, sort: r => r.driver },
    { id: 'policy', header: 'When a VolumeSnapshot is deleted', cell: r => (r.deletionPolicy === 'Delete' ? 'Delete the Ceph snapshot' : 'Keep the Ceph snapshot'), sort: r => r.deletionPolicy },
    { id: 'serves', header: 'Serves', cell: r => (r.serves.length ? <Mono>{r.serves.join(', ')}</Mono> : 'No Ceph class'), sort: r => r.serves.join(',') },
    {
      id: 'act',
      header: '',
      align: 'right',
      width: 48,
      cell: r => (
        <IconAction
          icon="mdi:delete-outline"
          label={canDelete ? `Delete ${r.name}` : 'Your role may not delete VolumeSnapshotClasses'}
          disabled={!canDelete}
          onClick={() => deleteSnapshotClass(r.obj, r.serves)}
        />
      ),
    },
  ];
  return (
    <Panel title="Volume snapshot classes" icon="mdi:camera-outline" dense>
      <DataTable
        label="Ceph snapshot classes"
        rows={rows}
        columns={cols}
        rowKey={r => r.name}
        empty={
          <Empty icon="mdi:camera-off-outline" title="No snapshot class for a Ceph driver">
            VolumeSnapshots of Ceph volumes need one. Create it with a StorageClass in the wizard, or with “Add snapshot class” on a class.
          </Empty>
        }
      />
    </Panel>
  );
}
