/*
 * One pool: its capacity strata on the basalt band (stored data, the
 * cost of copies or coding chunks, free space, quota and near-full
 * lines, its share of the cluster), then its settings, live I/O, PGs,
 * autoscaler, RBD images, the Kubernetes objects that use it and the
 * CephBlockPool that manages it.
 */

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import yaml from 'js-yaml';
import React from 'react';
import { out, useCeph, useCephQuery } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { denied, rookAttrs, useCan } from '../../api/permissions';
import { deletePoolFlow } from '../../api/poolOps';
import { rbdKey } from '../../api/rbdOps';
import { bytes, count, ops, pct, plural, rate } from '../../model/format';
import {
  blockPoolName,
  formFromCr,
  objectStoresSharing,
  ownerLabel,
  poolPgStates,
  poolStrata,
  pvsUsing,
  radosNamespacesOf,
  snapshotClassesFor,
  typeLabel,
} from '../../model/pools';
import { parseRbdDu, pvImageKey } from '../../model/rbd';
import { Obj } from '../../model/types';
import { LiveGate } from '../../shell/Gate';
import { imageHref, useNav } from '../../shell/nav';
import { TimeChart } from '../../ui/charts';
import { Column as Col, DataTable } from '../../ui/DataTable';
import { confirm } from '../../ui/dialogs';
import { Action, Band, Empty, Figure, Grid, KV, Mono, Notice, Page, Panel, Tag, When } from '../../ui/kit';
import { Mark, StateLabel } from '../../ui/Mark';
import { SERIES, STATE, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { phaseTone, PoolRow, RLink, usePoolRows } from './common';
import { openPoolForm } from './PoolForm';
import { Column, Legend, Stratum } from './Strata';

export function PoolPage({ name }: { name: string }) {
  const c = useCeph();
  const k = useKube();
  const nav = useNav();
  const rows = usePoolRows();
  const row = rows.find(r => r.pool.name === name);
  const cr = k.blockPools.items.find(p => p.metadata.namespace === k.ns && blockPoolName(p) === name) ?? row?.owner.cr;
  const isCbp = row ? row.owner.kind === 'CephBlockPool' : !!cr && cr.kind === 'CephBlockPool';
  const canEdit = useCan(rookAttrs('update', 'cephblockpools', k.ns));
  const canDelete = useCan(rookAttrs('delete', 'cephblockpools', k.ns));
  const live = c.phase === 'ready' ? null : c.reason || "Waiting for Ceph's live state";
  const rbd = !!row?.pool.applications.includes('rbd');
  const ownerNote = row && !isCbp ? row.owner.about : null;

  const onDelete = async () => {
    if (!cr || !row) return;
    const pvs = pvsUsing(name, k.pvs.items, k.ns);
    const ok = await deletePoolFlow(
      c.ns,
      cr,
      {
        pool: name,
        owner: row.owner,
        storageClasses: row.scs,
        pvs,
        radosNamespaces: radosNamespacesOf(cr, k.radosNamespaces.items),
        objectStores: objectStoresSharing(name, k.objectStores.items),
      },
      {
        pool: row.pool,
        // Why the pool cannot be deleted yet, with one way out: close.
        onBlocked: b =>
          confirm({ infoOnly: true, title: `Pool ${name} cannot be deleted yet`, body: 'Rook would refuse, or volumes would break. Clear these first:', consequences: b }),
        onDone: () => c.refresh(),
      }
    );
    if (ok) nav.go('pools');
  };

  const subtitle = row
    ? `${typeLabel(row.pool)}${row.rule ? `, spread across ${row.rule.failureDomain}s${row.rule.deviceClass ? ` on ${row.rule.deviceClass} disks` : ''}` : ''}. ${
        row.owner.kind === 'CephBlockPool' ? `Managed by the CephBlockPool ${row.owner.name}.` : `${ownerLabel(row.owner)}.`
      }`
    : cr && c.phase !== 'ready'
    ? `Managed by the CephBlockPool ${cr.metadata.name}. Usage and placement need Ceph's live state.`
    : cr
    ? `CephBlockPool ${cr.metadata.name}: Rook has not created the Ceph pool yet.`
    : 'A Ceph pool.';

  return (
    <Page
      title={<Mono>{name}</Mono>}
      subtitle={subtitle}
      actions={
        <>
          {rbd && (
            <Action icon="mdi:harddisk" onClick={() => nav.go('rbd', name)}>
              Open block images
            </Action>
          )}
          {isCbp && cr && (
            <>
              <Action
                icon="mdi:pencil-outline"
                reason={denied(canEdit, 'changing CephBlockPools') ?? live}
                onClick={() => openPoolForm({ mode: 'edit', cr, pool: row?.pool })}
              >
                Change settings
              </Action>
              <Action icon="mdi:delete-outline" color="error" reason={denied(canDelete, 'deleting CephBlockPools') ?? live} onClick={onDelete}>
                Delete pool
              </Action>
            </>
          )}
        </>
      }
    >
      <LiveGate>
        {row ? (
          <>
            <PoolBand row={row} />
            {ownerNote && (
              <Notice tone="idle" title={`Not managed by a CephBlockPool: ${ownerLabel(row.owner)}`}>
                {ownerNote} Cairn offers no edit or delete for it here.
              </Notice>
            )}
            <Grid min={560}>
              <DetailsPanel row={row} />
              <PgPanel row={row} />
            </Grid>
            <IoPanel row={row} />
            <Grid min={560}>
              {rbd && <RbdSummary pool={name} />}
              <KubePanel row={row} />
            </Grid>
          </>
        ) : cr ? null : (
          <Panel>
            <Empty icon="mdi:database-search-outline" title={`No pool named ${name}`} action={<RLink to={nav.href('pools')}>All pools</RLink>}>
              Ceph has no pool with this name and no CephBlockPool manages one. It may have been deleted.
            </Empty>
          </Panel>
        )}
      </LiveGate>
      {cr && <CrPanel cr={cr} />}
    </Page>
  );
}

/* --------------------------------------------------------- the band */

function PoolBand({ row }: { row: PoolRow }) {
  const t = useTokens();
  const c = useCeph();
  const p = row.pool;
  const df = c.core.df;
  const total = df?.total ?? 0;
  const near = c.core.osdMap?.nearFullRatio ?? 0.85;
  const full = c.core.osdMap?.fullRatio ?? 0.95;
  const s = poolStrata(p, { total, usedRaw: df?.usedRaw ?? 0, nearFullRatio: near, fullRatio: full });
  if (!s || !p.usage) return null;
  const u = p.usage;
  const quota = p.quotaBytes || u.quotaBytes;
  const strata: Stratum[] = [
    { key: 'stored', label: 'Data stored', value: s.stored, fill: '#5B97EA', detail: bytes(s.stored) },
    {
      key: 'overhead',
      label: p.type === 'erasure' ? 'Coding chunks' : `Extra copies (${p.size - 1})`,
      value: s.overhead,
      fill: '#5B97EA',
      texture: 'hatch',
      detail: bytes(s.overhead),
    },
    { key: 'free', label: 'Free for this pool (raw)', value: s.free, fill: '#93A4AE', texture: 'dots', detail: bytes(s.free) },
  ];
  const marks = [
    ...(s.quotaAt !== null ? [{ at: s.quotaAt, label: `Quota ${bytes(quota)}`, color: '#E8EEF1' }] : []),
    ...(s.nearFullAt !== null ? [{ at: s.nearFullAt, label: `Near full ${pct(near, 0)}`, color: '#D9A02B' }] : []),
  ];
  const share = total ? u.used / total : 0;
  const others = Math.max(0, (df?.usedRaw ?? 0) - u.used);
  const compressed = u.compressUnderBytes > 0;
  return (
    <Band>
      <Box sx={{ display: 'grid', gap: { xs: 2, md: 4 }, gridTemplateColumns: { xs: 'auto minmax(0, 1fr)', lg: 'auto minmax(0, 1fr) minmax(240px, 320px)' }, alignItems: 'start' }}>
        <Box sx={{ gridRow: { xs: 'span 2', lg: 'auto' } }}>
          <Column strata={strata} total={s.total} marks={marks} label={`${p.name}: ${bytes(u.used)} raw used, ${bytes(s.free)} raw free`} />
        </Box>
        <Box sx={{ maxWidth: 680, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ fontSize: 16, fontWeight: 600, color: t.basaltText }}>Capacity</Box>
            <BandState tone={row.state.tone} word={row.state.word} title={row.state.detail} />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 2 }}>
            <Figure onBand value={bytes(u.stored)} label="Stored" sub={`${count(u.objects)} objects`} />
            <Figure onBand value={bytes(u.maxAvail)} label="Room for data" sub="before the OSDs fill" />
            <Figure onBand value={pct(u.percentUsed)} label="Used" sub={quota ? `quota ${pct(u.stored / quota)} used` : 'no quota'} />
            <Figure onBand
              value={`${Number.isInteger(p.rawFactor) ? p.rawFactor : p.rawFactor.toFixed(2)}×`}
              label="Raw per stored byte"
              sub={compressed ? `compression saves ${bytes(u.compressUnderBytes - u.compressBytesUsed)}` : p.type === 'erasure' ? 'erasure coded' : 'replicated'}
            />
          </Box>
          <Legend strata={strata} />
        </Box>
        <Box sx={{ gridColumn: { xs: '2', lg: 'auto' }, maxWidth: 420, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ fontSize: 13.5, fontWeight: 600, color: t.basaltText }}>Share of the cluster</Box>
          <Box sx={{ fontSize: 13, color: t.basaltMuted }}>
            {p.name} takes {pct(share)} of the cluster’s {bytes(total)} raw capacity.
          </Box>
          <Box role="img" aria-label={`This pool ${pct(share)}, other pools ${pct(others / (total || 1))}, free ${pct((df?.avail ?? 0) / (total || 1))}`} sx={{ display: 'flex', height: 10, borderRadius: 1, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
            <Box sx={{ width: `${share * 100}%`, background: '#5B97EA' }} />
            <Box sx={{ width: `${(others / (total || 1)) * 100}%`, background: 'repeating-linear-gradient(135deg, #93A4AE 0 2px, transparent 2px 5px)' }} />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.5, rowGap: 0.25, fontSize: 12.5, color: t.basaltMuted, ...tabular }}>
            <span>This pool</span>
            <span>{bytes(u.used)}</span>
            <span>Other pools and overhead</span>
            <span>{bytes(others)}</span>
            <span>Free</span>
            <span>{bytes(df?.avail)}</span>
          </Box>
        </Box>
      </Box>
    </Band>
  );
}

function BandState({ tone, word, title }: { tone: keyof typeof STATE; word: string; title?: string }) {
  const t = useTokens();
  return (
    <Box component="span" title={title} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: t.basaltText, fontSize: 13.5 }}>
      <Mark tone={tone} />
      {word}
    </Box>
  );
}

/* ------------------------------------------------------- the panels */

function DetailsPanel({ row }: { row: PoolRow }) {
  const p = row.pool;
  const r = row.rule;
  const u = p.usage;
  return (
    <Panel title="Settings" icon="mdi:tune-variant">
      <KV
        rows={[
          ['Pool id', p.id],
          ['Protection', typeLabel(p)],
          p.type === 'erasure' && ['Erasure profile', <Mono key="p">{p.ecProfile}</Mono>],
          ['CRUSH rule', r ? <span key="r"><Mono>{r.name}</Mono>: from {r.root}, one per {r.failureDomain}, {r.deviceClass ? `${r.deviceClass} only` : 'any device class'}</span> : <Mono key="r">{p.crushRule}</Mono>],
          ['Applications', p.applications.length ? p.applications.join(', ') : 'None (Ceph warns about pools without one)'],
          ['Compression', p.compressionMode === 'none' ? 'Off' : `${p.compressionMode}${u?.compressUnderBytes ? `: ${bytes(u.compressUnderBytes)} compressed to ${bytes(u.compressBytesUsed)}` : ''}`],
          ['Quota', p.quotaBytes || p.quotaObjects ? [p.quotaBytes ? bytes(p.quotaBytes) : null, p.quotaObjects ? `${count(p.quotaObjects)} objects` : null].filter(Boolean).join(', ') : 'None'],
          ['Flags', p.flags.length ? p.flags.join(', ') : '—'],
          ['Managed by', <span key="o" title={row.owner.about}>{ownerLabel(row.owner)}{row.owner.role ? ` (${row.owner.role})` : ''}</span>],
          ['Created', p.createdAt ? <When at={p.createdAt} /> : '—'],
          u && ['Lifetime I/O', `${count(u.rdOps)} reads (${bytes(u.rdBytes)}), ${count(u.wrOps)} writes (${bytes(u.wrBytes)})`],
        ]}
      />
    </Panel>
  );
}

function PgPanel({ row }: { row: PoolRow }) {
  const t = useTokens();
  const c = useCeph();
  const p = row.pool;
  const a = row.autoscale;
  const pgs = c.core.pgs.filter(x => x.pool === p.id);
  const states = poolPgStates(c.core.pgs, p.id);
  const tone = (s: string) => states.find(x => x.state === s)?.tone ?? 'idle';
  return (
    <Panel title="Placement groups" icon="mdi:grid">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {pgs.length > 0 && pgs.length <= 4096 && (
          <Box
            role="img"
            aria-label={states.map(s => `${s.count} ${s.state}`).join(', ')}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: '3px', maxHeight: 160, overflow: 'auto' }}
          >
            {[...pgs]
              .sort((x, y) => x.pgid.localeCompare(y.pgid, undefined, { numeric: true }))
              .map(g => (
                <Tooltip key={g.pgid} title={`${g.pgid}: ${g.state}, on ${g.acting.map(o => `osd.${o}`).join(', ')}`} disableInteractive>
                  <Box
                    component="span"
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '3px',
                      background: tone(g.state) === 'idle' ? 'transparent' : STATE[tone(g.state)],
                      border: tone(g.state) === 'idle' ? `1.5px solid ${STATE.idle}` : 'none',
                      opacity: tone(g.state) === 'ok' ? 0.75 : 1,
                    }}
                  />
                </Tooltip>
              ))}
          </Box>
        )}
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }}>
          {states.map(s => (
            <Box component="li" key={s.state} sx={{ display: 'flex', gap: 1, fontSize: 13.5, ...tabular }}>
              <StateLabel tone={s.tone}>{s.state}</StateLabel>
              <Box sx={{ ml: 'auto', color: t.muted }}>{s.count}</Box>
            </Box>
          ))}
          {!states.length && <Box sx={{ color: t.muted, fontSize: 13.5 }}>The PG list has not been read yet.</Box>}
        </Box>
        <KV
          rows={[
            ['pg_num', p.pgNumTarget !== p.pgNum ? `${p.pgNum}, moving to ${p.pgNumTarget}` : p.pgNum],
            ['pgp_num', p.pgpNum],
            ['Autoscaler', `${p.autoscaleMode}${a?.bulk ? ', bulk' : ''}`],
            a && ['Autoscaler would set', `${a.pgNumFinal} (ideal ${a.pgNumIdeal})${a.wouldAdjust ? ': it will adjust' : ''}`],
            a && ['Capacity share', `${pct(a.capacityRatio)} of its root${a.targetRatio ? `, target ratio ${a.targetRatio}` : ''}${a.targetBytes ? `, target ${bytes(a.targetBytes)}` : ''}`],
          ]}
        />
        {a && p.autoscaleMode === 'warn' && a.wouldAdjust && (
          <Notice tone="warn">The autoscaler would change pg_num to {a.pgNumFinal} but is set to warn only.</Notice>
        )}
      </Box>
    </Panel>
  );
}

function IoPanel({ row }: { row: PoolRow }) {
  const id = row.pool.id;
  const io = row.pool.io;
  return (
    <Panel
      title="Client I/O"
      icon="mdi:chart-areaspline"
      actions={
        <Box sx={{ fontSize: 13, color: 'text.secondary', ...tabular }}>
          {io ? `${rate(io.readBps)} read, ${rate(io.writeBps)} written, ${ops(io.readOps + io.writeOps)}` : '—'}
        </Box>
      }
    >
      <Grid min={480}>
        <TimeChart
          title="Throughput"
          latest
          format={rate}
          series={[
            { name: 'Read', key: `pool.${id}.readBps`, color: SERIES.read },
            { name: 'Write', key: `pool.${id}.writeBps`, color: SERIES.write },
          ]}
        />
        <TimeChart
          title="Operations"
          latest
          format={ops}
          series={[
            { name: 'Read', key: `pool.${id}.readOps`, color: SERIES.read },
            { name: 'Write', key: `pool.${id}.writeOps`, color: SERIES.write },
          ]}
        />
      </Grid>
    </Panel>
  );
}

function RbdSummary({ pool }: { pool: string }) {
  const t = useTokens();
  const nav = useNav();
  const q = useCephQuery(`${rbdKey(pool)}:du`, [{ t: 'cli', bin: 'rbd', args: ['du', '--format', 'json', '--pool', pool] }], { intervalMs: 60000, staleMs: 30000 });
  const raw = out(q.data);
  const du = raw ? parseRbdDu(raw) : null;
  const err = q.data?.[0] && q.data[0].r !== 0 ? (q.data[0].err || '').trim().split('\n').pop() : q.error;
  return (
    <Panel title="Block images" icon="mdi:harddisk" actions={<RLink to={nav.href('rbd', pool)}>Open images</RLink>}>
      {du ? (
        du.byImage.size ? (
          <KV
            rows={[
              ['Images', du.byImage.size],
              ['Provisioned', bytes(du.provisioned)],
              ['Written', `${bytes(du.used)} (${pct(du.provisioned ? du.used / du.provisioned : 0)} of provisioned)`],
            ]}
          />
        ) : (
          <Box sx={{ color: t.muted, fontSize: 13.5 }}>No images in the default namespace yet.</Box>
        )
      ) : err ? (
        <Notice tone="err" title="Ceph could not list the images">
          {err}
        </Notice>
      ) : (
        <Box sx={{ color: t.muted, fontSize: 13.5 }}>Reading image usage…</Box>
      )}
    </Panel>
  );
}

function KubePanel({ row }: { row: PoolRow }) {
  const t = useTokens();
  const k = useKube();
  const name = row.pool.name;
  const pvs = pvsUsing(name, k.pvs.items, k.ns);
  const classes = snapshotClassesFor(row.scs, k.snapshotClasses.items, k.ns);
  const nss = radosNamespacesOf(row.owner.kind === 'CephBlockPool' ? row.owner.cr : undefined, k.radosNamespaces.items);
  const pvCols: Col<Obj>[] = [
    {
      id: 'claim',
      header: 'Claim',
      cell: pv => (pv.spec?.claimRef ? <Mono>{`${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}`}</Mono> : '—'),
      sort: pv => `${pv.spec?.claimRef?.namespace}/${pv.spec?.claimRef?.name}`,
      width: 240,
    },
    { id: 'size', header: 'Size', cell: pv => pv.spec?.capacity?.storage ?? '—', sort: pv => pv.spec?.capacity?.storage ?? '' },
    {
      id: 'image',
      header: 'Image',
      cell: pv => {
        const key = pvImageKey(pv);
        if (!key) return '—';
        const [p, ns, ...img] = key.split('/');
        return (
          <RLink to={imageHref(p, img.join('/'), ns)}>
            <Mono>{img.join('/')}</Mono>
          </RLink>
        );
      },
      width: 190,
      minWidth: 560,
    },
    { id: 'phase', header: 'Phase', cell: pv => <StateLabel tone={phaseTone(pv.status?.phase)}>{pv.status?.phase ?? '—'}</StateLabel>, sort: pv => pv.status?.phase ?? '' },
  ];
  return (
    <Panel title="Kubernetes" icon="mdi:kubernetes">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <KV
          rows={[
            [
              'StorageClasses',
              row.scs.length ? (
                <Box key="sc" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  {row.scs.map(u => (
                    <span key={u.sc.metadata.name}>
                      <Mono>{u.sc.metadata.name}</Mono>
                      <Box component="span" sx={{ color: t.muted }}>
                        {' '}
                        {u.via === 'dataPool' ? 'puts image data here (dataPool)' : u.via === 'topology' ? 'one of its topology pools' : 'provisions here'}, reclaim {u.sc.reclaimPolicy ?? 'Delete'}
                        {u.sc.allowVolumeExpansion ? ', expandable' : ''}
                      </Box>
                    </span>
                  ))}
                </Box>
              ) : (
                'None: no volume can be provisioned here from Kubernetes'
              ),
            ],
            ['Snapshot classes', classes.length ? classes.map(c => c.metadata.name).join(', ') : 'None'],
            nss.length > 0 && ['RADOS namespaces', nss.map(r => r.spec?.name || r.metadata.name).join(', ')],
            ['PersistentVolumes', plural(pvs.length, 'volume')],
          ]}
        />
        {pvs.length > 0 && (
          <Box sx={{ border: `1px solid ${t.rule}`, borderRadius: `${t.radius.small}px`, maxHeight: 360, overflow: 'auto' }}>
            <DataTable label="PersistentVolumes in this pool" rows={pvs} columns={pvCols} rowKey={pv => pv.metadata.name} initialSort={{ id: 'claim', dir: 'asc' }} />
          </Box>
        )}
      </Box>
    </Panel>
  );
}

function CrPanel({ cr }: { cr: Obj }) {
  const t = useTokens();
  const st = cr.status ?? {};
  const gen = cr.metadata.generation;
  const synced = st.observedGeneration === undefined || gen === undefined || st.observedGeneration >= gen;
  const spec = React.useMemo(() => yaml.dump(cr.spec ?? {}, { noRefs: true, lineWidth: 100 }), [cr]);
  const conds: any[] = Array.isArray(st.conditions) ? st.conditions : [];
  return (
    <Panel title={`CephBlockPool ${cr.metadata.name}`} icon="mdi:file-document-outline">
      <Grid min={380}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <KV
            rows={[
              ['Phase', <StateLabel key="p" tone={phaseTone(st.phase)}>{st.phase ?? 'Not reconciled yet'}</StateLabel>],
              st.message && ['Message', st.message],
              ['Reconciled', synced ? `Yes (generation ${gen ?? '—'})` : `Not yet: Rook has seen generation ${st.observedGeneration}, the spec is at ${gen}`],
              st.poolID !== undefined && ['Ceph pool id', st.poolID],
              st.info && Object.keys(st.info).length > 0 && ['Info', Object.entries(st.info).map(([a, b]) => `${a}: ${b}`).join(', ')],
              ['Namespace', cr.metadata.namespace],
              ['Created', <When key="c" at={cr.metadata.creationTimestamp} />],
              cr.metadata.deletionTimestamp && ['Deleting since', <When key="d" at={cr.metadata.deletionTimestamp} />],
            ]}
          />
          {conds.length > 0 && (
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}>
              {conds.map((x, i) => (
                <Box component="li" key={i} sx={{ fontSize: 13.5 }}>
                  <StateLabel tone={x.status === 'True' ? (/fail|error/i.test(x.type) ? 'err' : 'ok') : 'idle'}>
                    {x.type}: {x.status}
                  </StateLabel>
                  {(x.reason || x.message) && (
                    <Box sx={{ color: t.muted, fontSize: 12.5, ml: 2 }}>
                      {x.reason}
                      {x.message ? `: ${x.message}` : ''} <When at={x.lastTransitionTime} />
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
        <Box>
          <Box sx={{ fontSize: 12.5, color: t.muted, mb: 0.5 }}>Spec</Box>
          <Box
            component="pre"
            aria-label="CephBlockPool spec as YAML"
            sx={{
              m: 0,
              p: 1.25,
              fontFamily: t.font.mono,
              fontSize: 12.5,
              lineHeight: 1.5,
              background: t.sunken,
              border: `1px solid ${t.rule}`,
              borderRadius: `${t.radius.small}px`,
              overflow: 'auto',
              maxHeight: 320,
            }}
          >
            {spec}
          </Box>
          <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {formFromCr(cr).rbdStats && <Tag>per-image statistics on</Tag>}
            {cr.spec?.mirroring?.enabled && <Tag tone="move">mirroring {cr.spec.mirroring.mode}</Tag>}
          </Box>
        </Box>
      </Grid>
    </Panel>
  );
}
