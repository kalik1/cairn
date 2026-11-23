/*
 * Volumes backed by Ceph: every PersistentVolume a Ceph CSI driver made,
 * with its claim, class, size and modes, where the data lives (pool and RBD
 * image, or CephFS subvolume) and who mounts it (pods, and VMs through
 * their virt-launcher pods). Claims of Ceph classes still waiting for a
 * volume are listed too.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useAllPods, useKube } from '../../api/kube';
import { cephVolumes, filterVolumes, shortMode, statusTone, VolumeFilter, VolumeRow, volumeTotals } from '../../model/cephvolumes';
import { bytes, plural } from '../../model/format';
import { Loading } from '../../shell/Gate';
import { imageHref, poolHref } from '../../shell/nav';
import { Column, DataTable } from '../../ui/DataTable';
import { Empty, Figure, IconAction, KV, Mono, Notice, Panel, Toolbar } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { CLink, SearchField, SmallSelect } from './parts';

function Backing({ r }: { r: VolumeRow }) {
  if (r.kind === 'rbd' && r.pool && r.image)
    return (
      <Box
        component="span"
        sx={{ display: 'inline-block', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom', '& > *': { mr: 0.5 } }}
      >
        <CLink to={poolHref(r.pool)}>
          <Mono>{r.pool}</Mono>
        </CLink>
        <Box component="span" sx={{ opacity: 0.6 }}>
          /
        </Box>
        <CLink to={imageHref(r.pool, r.image, r.radosNamespace)} title={`RBD image ${r.pool}/${r.radosNamespace ? `${r.radosNamespace}/` : ''}${r.image}`}>
          <Mono>{r.radosNamespace ? `${r.radosNamespace}/${r.image}` : r.image}</Mono>
        </CLink>
      </Box>
    );
  if (r.kind === 'cephfs' && r.subvolume)
    return (
      <Mono title={r.subvolumePath}>
        {r.fsName ? `${r.fsName}: ` : ''}
        {r.subvolume}
      </Mono>
    );
  if (r.status === 'Pending') return <>Not made yet</>;
  return <>—</>;
}

function UsedBy({ r }: { r: VolumeRow }) {
  if (!r.consumers.length) return <Box component="span" sx={{ color: 'text.secondary' }}>{r.status === 'Bound' ? 'Nobody' : '—'}</Box>;
  const vms = [...new Set(r.consumers.filter(c => c.vm).map(c => c.vm))];
  const pods = r.consumers.filter(c => !c.vm);
  const parts = [...vms.map(v => `VM ${v}`), ...pods.map(p => p.pod)];
  return (
    <Box component="span" title={r.consumers.map(c => `${c.pod} on ${c.node ?? '?'} (${c.phase})`).join('\n')}>
      {parts.slice(0, 2).join(', ')}
      {parts.length > 2 ? ` +${parts.length - 2}` : ''}
    </Box>
  );
}

export function VolumesTab() {
  const kube = useKube();
  const t = useTokens();
  const pods = useAllPods();
  const [f, setF] = React.useState<VolumeFilter>({ q: '', storageClass: '', status: '', use: '' });
  const [sel, setSel] = React.useState<string | null>(null);
  const rows = React.useMemo(
    () => cephVolumes(kube.pvs.items, kube.pvcs.items, kube.storageClasses.items, pods.items),
    [kube.pvs.items, kube.pvcs.items, kube.storageClasses.items, pods.items]
  );
  const shown = React.useMemo(() => filterVolumes(rows, f), [rows, f]);
  const totals = volumeTotals(rows);
  if (!kube.pvs.loaded || !kube.pvcs.loaded) return <Loading label="Reading volumes…" />;
  const classes = [...new Set(rows.map(r => r.storageClass).filter(Boolean) as string[])].sort();
  const statuses = [...new Set(rows.map(r => r.status))].sort();
  const current = rows.find(r => r.key === sel) ?? null;

  const cols: Column<VolumeRow>[] = [
    {
      id: 'claim',
      header: 'Claim',
      cell: r => (r.claimName ? <Mono>{`${r.claimNs}/${r.claimName}`}</Mono> : <Box component="span" sx={{ color: t.muted }}>No claim</Box>),
      sort: r => `${r.claimNs ?? '~'}/${r.claimName ?? ''}`,
      width: 260,
    },
    { id: 'sc', header: 'Class', cell: r => (r.storageClass ? <Mono>{r.storageClass}</Mono> : '—'), sort: r => r.storageClass ?? '', minWidth: 1000 },
    { id: 'size', header: 'Size', cell: r => bytes(r.sizeBytes), sort: r => r.sizeBytes, align: 'right' },
    { id: 'access', header: 'Access', cell: r => r.accessModes.map(shortMode).join(', ') || '—', sort: r => r.accessModes.join(','), minWidth: 900 },
    { id: 'mode', header: 'Mode', cell: r => r.volumeMode, sort: r => r.volumeMode, minWidth: 1000 },
    { id: 'status', header: 'Status', cell: r => <StateLabel tone={statusTone(r.status)}>{r.status}</StateLabel>, sort: r => r.status },
    { id: 'ceph', header: 'Ceph data', cell: r => <Backing r={r} />, sort: r => `${r.pool ?? r.fsName ?? ''}/${r.image ?? r.subvolume ?? ''}`, width: 300 },
    { id: 'used', header: 'Used by', cell: r => <UsedBy r={r} />, sort: r => r.consumers.map(c => c.vm ?? c.pod).join(','), width: 200 },
    { id: 'pv', header: 'Volume', cell: r => <Mono muted>{r.pvName ?? '—'}</Mono>, sort: r => r.pvName ?? '', minWidth: 1450 },
  ];

  return (
    <>
      <Panel dense>
        <Box sx={{ display: 'flex', gap: { xs: 3, md: 5 }, flexWrap: 'wrap', px: 2, py: 1.5 }}>
          <Figure value={totals.count} label={totals.count === 1 ? 'Ceph volume' : 'Ceph volumes'} />
          <Figure value={bytes(totals.bytes)} label="provisioned" />
          <Figure value={totals.vms} label={totals.vms === 1 ? 'VM uses them' : 'VMs use them'} />
          <Figure value={totals.idle} label="bound, mounted by nobody" />
          <Figure value={totals.notBound} label="not bound" tone={totals.notBound ? 'warn' : undefined} />
        </Box>
      </Panel>
      {pods.forbidden && (
        <Notice tone="idle" title="Who uses each volume is not shown">
          Your role may not list pods in every namespace; the rest of the list is complete.
        </Notice>
      )}
      <Panel dense>
        <Toolbar sx={{ gap: 1, py: 1 }}>
          <SearchField value={f.q ?? ''} onChange={q => setF({ ...f, q })} placeholder="Search claims, images, VMs, pods" width={300} name="vol-search" />
          <SmallSelect
            label="Class"
            value={f.storageClass ?? ''}
            onChange={v => setF({ ...f, storageClass: v })}
            options={[{ value: '', label: 'All classes' }, ...classes.map(c => ({ value: c, label: c }))]}
          />
          <SmallSelect
            label="Status"
            value={f.status ?? ''}
            width={150}
            onChange={v => setF({ ...f, status: v })}
            options={[{ value: '', label: 'Any status' }, ...statuses.map(s => ({ value: s, label: s }))]}
          />
          <SmallSelect
            label="Used by"
            value={(f.use ?? '') as string}
            width={170}
            onChange={v => setF({ ...f, use: v as VolumeFilter['use'] })}
            options={[
              { value: '', label: 'Anyone or nobody' },
              { value: 'vm', label: 'A virtual machine' },
              { value: 'pod', label: 'Pods only' },
              { value: 'idle', label: 'Nobody' },
            ]}
          />
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12.5, color: t.muted, pr: 1 }}>
            {shown.length === rows.length ? plural(rows.length, 'volume') : `${shown.length} of ${rows.length}`}
          </Typography>
        </Toolbar>
        <DataTable
          label="Ceph volumes"
          rows={shown}
          columns={cols}
          rowKey={r => r.key}
          activeKey={current?.key}
          onOpen={r => setSel(s => (s === r.key ? null : r.key))}
          empty={
            rows.length ? (
              <Empty icon="mdi:filter-off-outline" title="No volume matches">
                Clear the search or a filter to see more.
              </Empty>
            ) : (
              <Empty icon="mdi:harddisk-remove" title="No volume uses Ceph yet">
                Claims of a Ceph StorageClass appear here with their RBD image or CephFS subvolume, and the pods and VMs that use them.
              </Empty>
            )
          }
        />
      </Panel>
      {current && <VolumeDetail r={current} onClose={() => setSel(null)} />}
    </>
  );
}

function VolumeDetail({ r, onClose }: { r: VolumeRow; onClose: () => void }) {
  const t = useTokens();
  const a = r.pv?.spec?.csi?.volumeAttributes ?? {};
  return (
    <Panel
      title={<Mono>{r.claimName ? `${r.claimNs}/${r.claimName}` : r.pvName}</Mono>}
      icon="mdi:harddisk"
      actions={<IconAction icon="mdi:close" label="Close" onClick={onClose} />}
    >
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <KV
          labelWidth={170}
          rows={[
            ['Status', <StateLabel key="s" tone={statusTone(r.status)}>{r.status}</StateLabel>],
            ['Claim', r.claimName ? <Mono key="c">{`${r.claimNs}/${r.claimName}`}</Mono> : 'None'],
            ['Volume', <Mono key="v">{r.pvName ?? 'Not made yet'}</Mono>],
            ['StorageClass', <Mono key="sc">{r.storageClass ?? '—'}</Mono>],
            ['Size', bytes(r.sizeBytes)],
            ['Access modes', r.accessModes.join(', ') || '—'],
            ['Volume mode', r.volumeMode],
            ['Reclaim policy', r.pv?.spec?.persistentVolumeReclaimPolicy ?? '—'],
            ['Driver', <Mono key="d">{r.driver ?? '—'}</Mono>],
            r.pvc?.status?.phase === 'Pending' && ['Waiting since', new Date(r.pvc.metadata.creationTimestamp ?? '').toLocaleString()],
          ]}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <KV
            labelWidth={150}
            rows={[
              ['Cluster ID', <Mono key="cid">{r.clusterID ?? '—'}</Mono>],
              !!r.pool && ['Pool', <CLink key="p" to={poolHref(r.pool)}><Mono>{r.pool}</Mono></CLink>],
              !!r.radosNamespace && ['RADOS namespace', <Mono key="rn">{r.radosNamespace}</Mono>],
              !!r.image && r.pool && ['RBD image', <CLink key="i" to={imageHref(r.pool, r.image, r.radosNamespace)}><Mono>{r.image}</Mono></CLink>],
              !!a.journalPool && a.journalPool !== r.pool && ['Journal pool', <Mono key="j">{a.journalPool}</Mono>],
              !!a.imageFeatures && ['Image features', <Mono key="f">{a.imageFeatures}</Mono>],
              !!r.fsName && ['Filesystem', <Mono key="fs">{r.fsName}</Mono>],
              !!r.subvolume && ['Subvolume', <Mono key="sv">{r.subvolume}</Mono>],
              !!r.subvolumePath && ['Path', <Mono key="sp">{r.subvolumePath}</Mono>],
              !!r.pv?.spec?.csi?.volumeHandle && ['Volume handle', <Mono key="h" muted>{r.pv.spec.csi.volumeHandle}</Mono>],
            ]}
          />
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.5 }}>{r.consumers.length ? 'Used by' : 'Nobody mounts it now'}</Typography>
            {r.consumers.map(c => (
              <Box key={`${c.namespace}/${c.pod}`} sx={{ display: 'flex', gap: 1, fontSize: 13, py: 0.4, borderBottom: `1px solid ${t.rule}` }}>
                {c.vm ? (
                  <span>
                    VM <Mono>{c.vm}</Mono>
                  </span>
                ) : (
                  <span>Pod</span>
                )}
                <Mono muted>{`${c.namespace}/${c.pod}`}</Mono>
                <Box sx={{ flex: 1 }} />
                <Box component="span" sx={{ color: t.muted }}>
                  {c.node ?? 'not scheduled'}, {c.phase}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Panel>
  );
}
