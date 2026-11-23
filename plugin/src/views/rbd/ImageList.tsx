/*
 * Block images of one pool (and RADOS namespace): thin provisioning on
 * the basalt band (what was promised, what was written, what the pool can
 * still hold), the images with usage, features, clones, snapshots, who
 * uses them in Kubernetes, and the RBD trash.
 */

import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { rbdOps,RbdWhere } from '../../api/rbdOps';
import { bytes, pct, plural } from '../../model/format';
import { bindingOf, decodeFeatures, ImageBinding, inUse, RbdImage, RbdTrashEntry, trashDeferred } from '../../model/rbd';
import { LiveGate, Loading } from '../../shell/Gate';
import { imageHref, useNav } from '../../shell/nav';
import { Column as Col, DataTable } from '../../ui/DataTable';
import { confirm } from '../../ui/dialogs';
import { Action, Band, Empty, IconAction, MiniBar, Mono, Notice, Page, Panel, Toolbar, ToolButton, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { RLink } from '../pools/common';
import { BandFigure } from '../pools/Strata';
import { CoreSample } from './CoreSample';
import { useBindings, useRbdList, useRbdPools } from './data';
import { openCreateImage } from './dialogs';
import { VmLinks } from './ImagePage';

interface Row {
  img: RbdImage;
  b: ImageBinding;
  used?: number;
}

export function ImageList({ pool: wanted }: { pool?: string }) {
  const c = useCeph();
  const nav = useNav();
  const pools = useRbdPools();
  const pool = wanted ?? pools[0]?.name;
  const [ns, setNs] = React.useState('');
  const list = useRbdList(pool, ns);
  const bindings = useBindings(pool, ns);
  const live = c.phase === 'ready' ? null : c.reason || "Waiting for Ceph's live state";
  const known = pools.some(p => p.name === pool);
  const w: RbdWhere = { cluster: c.ns, pool: pool ?? '', ns };
  const rows: Row[] = list.images.map(img => ({ img, b: bindingOf(bindings, img.name), used: list.du?.byImage.get(img.name)?.used }));
  const ecPools = c.core.pools.filter(p => p.type === 'erasure');

  return (
    <Page
      title="Block images"
      subtitle="RBD images: the virtual disks Ceph serves to Kubernetes volumes and virtual machines."
      actions={
        <Action
          icon="mdi:plus"
          variant="contained"
          reason={live ?? (!known ? 'Pick a pool that holds RBD images' : null)}
          onClick={() => openCreateImage(w, list.images.map(i => i.name), ecPools, name => nav.go('rbd', pool, name, ns || undefined))}
        >
          Create image
        </Action>
      }
    >
      <LiveGate>
        {pools.length === 0 ? (
          <Panel>
            <Empty icon="mdi:harddisk-plus" title="No pool holds block images yet" action={<RLink to={nav.href('pools')}>Go to pools</RLink>}>
              Block images live in pools tagged for RBD. Create a pool (application rbd) first; Rook prepares it for images.
            </Empty>
          </Panel>
        ) : (
          <>
            <Toolbar sx={{ border: 'none', px: 0, gap: 2 }}>
              <TextField select size="small" label="Pool" value={pool ?? ''} onChange={e => nav.go('rbd', e.target.value)} sx={{ minWidth: 220 }}>
                {!known && pool && <MenuItem value={pool}>{pool} (no RBD application)</MenuItem>}
                {pools.map(p => (
                  <MenuItem key={p.name} value={p.name}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
              {(list.namespaces.length > 0 || ns) && (
                <TextField select size="small" label="RADOS namespace" value={ns} onChange={e => setNs(e.target.value)} sx={{ minWidth: 200 }}>
                  <MenuItem value="">Default</MenuItem>
                  {list.namespaces.map(n => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <Box sx={{ ml: 'auto' }}>
                <RLink to={nav.href('pools', pool)}>Pool {pool}</RLink>
              </Box>
            </Toolbar>
            {!known && pool && (
              <Notice tone="warn" title={`${pool} is not tagged for RBD`}>
                Ceph lists images only in pools with the rbd application. Pick another pool.
              </Notice>
            )}
            {list.error ? (
              <Notice tone="err" title="Ceph could not list the images">
                {list.error}
              </Notice>
            ) : list.loading ? (
              <Loading label="Reading images…" />
            ) : (
              <>
                <ThinBand pool={pool!} rows={rows} du={list.du} duError={list.duError} />
                <Panel dense title={plural(rows.length, 'image')} icon="mdi:harddisk">
                  <ImageTable rows={rows} pool={pool!} ns={ns} />
                </Panel>
                <TrashPanel w={w} trash={list.trash} live={live} />
              </>
            )}
          </>
        )}
      </LiveGate>
    </Page>
  );
}

/* --------------------------------------------------------- the band */

function ThinBand({ pool, rows, du, duError }: { pool: string; rows: Row[]; du: ReturnType<typeof useRbdList>['du']; duError: string | null }) {
  const t = useTokens();
  const c = useCeph();
  const p = c.core.pools.find(x => x.name === pool);
  const provisioned = rows.reduce((n, r) => n + r.img.size, 0);
  const used = du ? rows.reduce((n, r) => n + (r.used ?? 0), 0) : null;
  const room = p?.usage ? p.usage.maxAvail : null;
  const canHold = used !== null && room !== null ? used + room : null;
  const over = canHold && provisioned > canHold ? provisioned / canHold : null;
  const busy = rows.filter(r => inUse(r.img, r.b)).length;
  return (
    <Band>
      <Box sx={{ display: 'flex', gap: { xs: 2, md: 4 }, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box>
            <Box sx={{ fontSize: 16, fontWeight: 600, color: t.basaltText }}>Thin provisioning</Box>
            <Box sx={{ fontSize: 13, color: t.basaltMuted }}>
              The core is everything promised to images in {pool}; the solid part is what they have written.
              {over ? ` The pool could not hold it all if every image filled up (${over.toFixed(1)}× promised).` : ''}
            </Box>
          </Box>
          {provisioned > 0 ? (
            <CoreSample
              length={provisioned}
              label={`${bytes(provisioned)} provisioned, ${used === null ? 'usage unknown' : `${bytes(used)} written`}`}
              parts={used !== null ? [{ key: 'used', label: `Written ${bytes(used)}`, value: used, fill: '#5B97EA' }] : []}
              marks={canHold !== null && canHold < provisioned * 1.6 ? [{ at: canHold, label: `Pool full at ${bytes(canHold)}`, color: '#D9A02B' }] : []}
              ticks={['0', bytes(provisioned / 2), bytes(provisioned)]}
            />
          ) : (
            <Box sx={{ color: t.basaltMuted, fontSize: 13.5 }}>No images yet.</Box>
          )}
          {duError && <Box sx={{ color: '#E0707A', fontSize: 12.5 }}>Usage unknown: {duError}</Box>}
        </Box>
        <Box sx={{ flex: '0 1 420px', ml: { xs: 0, lg: 'auto' }, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2 }}>
          <BandFigure value={bytes(provisioned)} label="Provisioned" sub={plural(rows.length, 'image')} />
          <BandFigure value={used === null ? '—' : bytes(used)} label="Written" sub={used !== null && provisioned ? `${pct(used / provisioned)} of provisioned` : undefined} />
          <BandFigure value={room === null ? '—' : bytes(room)} label="Pool room for data" sub="shared with other pools" />
          <BandFigure value={busy} label="In use" sub={`${rows.length - busy} idle`} />
        </Box>
      </Box>
    </Band>
  );
}

/* -------------------------------------------------------- the table */

function ImageTable({ rows, pool, ns }: { rows: Row[]; pool: string; ns: string }) {
  const t = useTokens();
  const nav = useNav();
  const sub = (x: React.ReactNode) => <Box sx={{ fontSize: 12, color: t.muted, ...tabular }}>{x}</Box>;
  const cols: Col<Row>[] = [
    {
      id: 'name',
      header: 'Image',
      cell: r => (
        <Box sx={{ minWidth: 0 }}>
          <RLink to={imageHref(pool, r.img.name, ns)}>
            <Mono>{r.img.name}</Mono>
          </RLink>
          {r.img.error && sub(r.img.error)}
        </Box>
      ),
      sort: r => r.img.name,
      width: 340,
    },
    { id: 'size', header: 'Provisioned', cell: r => bytes(r.img.size), sort: r => r.img.size, align: 'right' },
    {
      id: 'used',
      header: 'Written',
      cell: r =>
        r.used === undefined ? (
          '—'
        ) : (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <MiniBar pct={r.img.size ? (r.used / r.img.size) * 100 : 0} width={48} warnAt={101} errAt={101} />
            <span>{bytes(r.used)}</span>
          </Box>
        ),
      sort: r => r.used ?? -1,
      align: 'right',
    },
    {
      id: 'features',
      header: 'Features',
      cell: r => {
        const f = decodeFeatures(r.img.features);
        return (
          <Box component="span" title={f.map(x => x.name).join(', ')}>
            {plural(f.length, 'feature')}
            {f.some(x => x.name === 'journaling') ? ', journaling' : ''}
          </Box>
        );
      },
      sort: r => r.img.features,
      minWidth: 1250,
    },
    {
      id: 'parent',
      header: 'Clone of',
      cell: r =>
        r.img.parent ? (
          <RLink to={imageHref(r.img.parent.pool, r.img.parent.image, r.img.parent.ns)}>
            <Mono>{`${r.img.parent.image}@${r.img.parent.snap}`}</Mono>
          </RLink>
        ) : (
          '—'
        ),
      sort: r => r.img.parent?.image ?? '',
      minWidth: 1100,
    },
    { id: 'snaps', header: 'Snapshots', cell: r => r.img.snaps.length || '—', sort: r => r.img.snaps.length, align: 'right' },
    { id: 'created', header: 'Created', cell: r => <When at={r.img.created} />, sort: r => r.img.created ?? 0, minWidth: 1000 },
    {
      id: 'use',
      header: 'In use',
      cell: r => {
        const w = r.img.watchers?.length ?? 0;
        return inUse(r.img, r.b) ? (
          <StateLabel tone="ok" title={r.img.watchers?.map(x => `client.${x.id} ${x.addr}`).join('\n')}>
            {w ? plural(w, 'client') : 'Mounted'}
          </StateLabel>
        ) : (
          <StateLabel tone="idle">Idle</StateLabel>
        );
      },
      sort: r => r.img.watchers?.length ?? 0,
    },
    {
      id: 'kube',
      header: 'Kubernetes',
      cell: r =>
        r.b.pvc ? (
          <Box sx={{ minWidth: 0 }}>
            <Mono>{`${r.b.pvc.metadata.namespace}/${r.b.pvc.metadata.name}`}</Mono>
            {r.b.vms.length > 0 ? sub(<VmLinks vms={r.b.vms} />) : r.b.pods.length ? sub(plural(r.b.pods.length, 'pod')) : null}
          </Box>
        ) : r.b.pv ? (
          <Mono>{r.b.pv.metadata.name}</Mono>
        ) : r.b.csi ? (
          <Box component="span" sx={{ color: t.muted }} title="Named like a Ceph-CSI volume, but no PersistentVolume points at it">
            CSI volume without a PV
          </Box>
        ) : (
          <Box component="span" sx={{ color: t.muted }}>
            Not in Kubernetes
          </Box>
        ),
      sort: r => (r.b.pvc ? `${r.b.pvc.metadata.namespace}/${r.b.pvc.metadata.name}` : 'zzz'),
      width: 320,
    },
  ];
  return (
    <DataTable
      label="Block images"
      rows={rows}
      columns={cols}
      rowKey={r => r.img.name}
      onOpen={r => nav.go('rbd', pool, r.img.name, ns || undefined)}
      initialSort={{ id: 'name', dir: 'asc' }}
      empty={
        <Empty icon="mdi:harddisk-plus" title="No images here">
          Create an image, or provision a volume from a StorageClass that points at this pool.
        </Empty>
      }
    />
  );
}

/* --------------------------------------------------------- the trash */

function TrashPanel({ w, trash, live }: { w: RbdWhere; trash: RbdTrashEntry[]; live: string | null }) {
  const t = useTokens();
  const expired = trash.filter(e => !trashDeferred(e));
  const restore = async (e: RbdTrashEntry) => {
    const ok = await confirm({
      title: `Restore ${e.name}`,
      body: <p>The image comes back as {e.name} in {w.ns ? `${w.pool}/${w.ns}` : w.pool}, with its data and snapshots.</p>,
      confirm: 'Restore image',
    });
    if (ok) await rbdOps.trashRestore(w, e.id, e.name).catch(() => undefined);
  };
  const remove = async (e: RbdTrashEntry) => {
    const deferred = trashDeferred(e);
    const ok = await confirm({
      title: `Remove ${e.name} for good`,
      danger: true,
      typeToConfirm: e.name,
      confirm: 'Remove image',
      consequences: [
        'The image and all its snapshots are deleted; this cannot be undone.',
        deferred ? `It is kept until ${new Date(e.deferredUntil!).toLocaleString()}: removing it now overrides that (--force).` : 'Its keep-until time has passed.',
      ],
    });
    if (ok) await rbdOps.trashRemove(w, e.id, e.name, deferred).catch(() => undefined);
  };
  const purge = async () => {
    const ok = await confirm({
      title: `Purge the trash of ${w.pool}`,
      danger: true,
      typeToConfirm: w.pool,
      confirm: 'Purge trash',
      consequences: [
        `${plural(expired.length, 'image')} whose keep-until time has passed ${expired.length === 1 ? 'is' : 'are'} deleted for good: ${expired.map(e => e.name).join(', ') || 'none'}.`,
        ...(trash.length > expired.length
          ? [`${plural(trash.length - expired.length, 'image')} still within ${trash.length - expired.length === 1 ? 'its' : 'their'} keep-until time ${trash.length - expired.length === 1 ? 'stays' : 'stay'}.`]
          : []),
        'Images with clones or protected snapshots are skipped by Ceph.',
      ],
    });
    if (ok) await rbdOps.trashPurge(w).catch(() => undefined);
  };
  const cols: Col<RbdTrashEntry>[] = [
    { id: 'name', header: 'Image', cell: e => <Mono>{e.name}</Mono>, sort: e => e.name, width: 300 },
    { id: 'id', header: 'Id', cell: e => <Mono muted>{e.id}</Mono>, sort: e => e.id },
    { id: 'source', header: 'Moved by', cell: e => e.source.toLowerCase(), sort: e => e.source },
    { id: 'deleted', header: 'Moved', cell: e => <When at={e.deleted} />, sort: e => e.deleted ?? 0 },
    {
      id: 'until',
      header: 'Kept until',
      cell: e =>
        trashDeferred(e) ? (
          <StateLabel tone="idle" title={new Date(e.deferredUntil!).toLocaleString()}>
            {new Date(e.deferredUntil!).toLocaleString()}
          </StateLabel>
        ) : (
          <Box component="span" sx={{ color: t.muted }}>
            Expired: purge removes it
          </Box>
        ),
      sort: e => e.deferredUntil ?? 0,
    },
    {
      id: 'actions',
      header: '',
      cell: e => (
        <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'flex-end' }}>
          <IconAction icon="mdi:restore" label={live ?? `Restore ${e.name}`} disabled={!!live} onClick={() => restore(e)} />
          <IconAction icon="mdi:delete-forever-outline" label={live ?? `Remove ${e.name} for good`} disabled={!!live} onClick={() => remove(e)} />
        </Box>
      ),
      align: 'right',
      width: 96,
    },
  ];
  return (
    <Panel
      dense
      title={`Trash${trash.length ? ` (${trash.length})` : ''}`}
      icon="mdi:delete-clock-outline"
      actions={
        <ToolButton icon="mdi:delete-sweep-outline" disabled={!!live || !expired.length} onClick={purge} tooltip={live ?? (expired.length ? undefined : 'Nothing has expired yet')}>
          Purge expired
        </ToolButton>
      }
    >
      <DataTable
        label="RBD trash"
        rows={trash}
        columns={cols}
        rowKey={e => e.id}
        initialSort={{ id: 'deleted', dir: 'desc' }}
        empty={
          <Box sx={{ px: 2, py: 1.5, color: t.muted, fontSize: 13.5 }}>
            The trash is empty. Images moved here keep their data until they are removed or purged, and can be restored.
          </Box>
        }
      />
    </Panel>
  );
}
