/*
 * One block image: a core sample of its provisioned size and what is
 * written (and held only by snapshots) on the basalt band; its details
 * and decoded features; snapshots with their operations; the clone
 * lineage; who uses it (watchers, the PV, the claim, pods, VMs). Images
 * the CSI driver owns get Kubernetes VolumeSnapshots instead of raw RBD
 * snapshots, and nothing that would pull data from under a running VM.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { useCanState } from '../../api/permissions';
import { rbdOps,RbdWhere } from '../../api/rbdOps';
import { bytes, count, pct, plural } from '../../model/format';
import {
  bindingOf,
  childrenOf,
  decodeFeatures,
  decodeFlags,
  decodeOpFeatures,
  ImageBinding,
  ImageRules,
  imageRules,
  inUse,
  RbdImage,
  RbdSnap,
  VmRef,
} from '../../model/rbd';
import { LiveGate, Loading } from '../../shell/Gate';
import { imageHref, useNav } from '../../shell/nav';
import { Column as Col, DataTable } from '../../ui/DataTable';
import { confirm } from '../../ui/dialogs';
import { Action, Band, Empty, Grid, IconAction, KV, Mono, Notice, Page, Panel, Tag, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { phaseTone, RLink } from '../pools/common';
import { BandFigure } from '../pools/Strata';
import { CoreSample } from './CoreSample';
import { hangarVmHref, RbdOne, useBindings, useCloneNeedsProtect, useRbdImage, useRbdPools } from './data';
import { openClone, openGrow, openSnapshot, openVolumeSnapshot } from './dialogs';

export function ImagePage({ pool, image, ns }: { pool: string; image: string; ns: string }) {
  const c = useCeph();
  const k = useKube();
  const nav = useNav();
  const one = useRbdImage(pool, ns, image);
  const bindings = useBindings(pool, ns);
  const b = bindingOf(bindings, image);
  const needsProtect = useCloneNeedsProtect();
  const pools = useRbdPools();
  const img = one.image;
  const live = c.phase === 'ready' ? null : c.reason || "Waiting for Ceph's live state";
  const w: RbdWhere = { cluster: c.ns, pool, ns };
  const rules = img ? imageRules(img, b, { cloneNeedsProtect: needsProtect, pool, ns, others: one.children }) : null;
  const canSnapK8s = useCanState(
    b.pvc ? { verb: 'create', group: 'snapshot.storage.k8s.io', resource: 'volumesnapshots', namespace: b.pvc.metadata.namespace } : null
  );
  const why = (v?: { ok: boolean; reason?: string }) => live ?? (v && !v.ok ? v.reason ?? 'Not possible' : null);
  const spec = ns ? `${pool}/${ns}/${image}` : `${pool}/${image}`;

  const trash = async () => {
    if (!img) return;
    const ok = await confirm({
      title: `Move ${image} to the trash`,
      confirm: 'Move to trash',
      consequences: [
        `${image} leaves the image list of ${pool}; its data and ${plural(img.snaps.length, 'snapshot')} stay in the pool’s RBD trash.`,
        'Restore it from the trash on the Block images page, or remove it from there for good.',
      ],
    });
    if (!ok) return;
    try {
      await rbdOps.trashMove(w, image);
      nav.go('rbd', pool);
    } catch {
      /* recorded in Activity */
    }
  };
  const flatten = async () => {
    if (!img?.parent) return;
    const ok = await confirm({
      title: `Flatten ${image}`,
      confirm: 'Flatten image',
      consequences: [
        `Every block ${image} still reads from ${img.parent.image}@${img.parent.snap} is copied into it: up to ${bytes(img.size)} more space.`,
        'Afterwards it no longer depends on the parent snapshot, which can then be unprotected or deleted.',
      ],
    });
    if (ok) await rbdOps.flatten(w, image).catch(() => undefined);
  };

  return (
    <Page
      title={<Mono>{image}</Mono>}
      subtitle={
        img ? (
          <>
            {bytes(img.size)} block image in <RLink to={nav.href('pools', pool)}>{pool}</RLink>
            {ns ? ` (namespace ${ns})` : ''}
            {b.vms.some(v => v.running) ? (
              <>
                , disk of the VM <VmLinks vms={b.vms.filter(v => v.running)} />.
              </>
            ) : b.pvc ? (
              `, bound to the claim ${b.pvc.metadata.namespace}/${b.pvc.metadata.name}.`
            ) : (
              '.'
            )}
          </>
        ) : (
          `RBD image in ${pool}.`
        )
      }
      actions={
        img &&
        rules && (
          <>
            {!b.csi ? (
              <Action icon="mdi:camera-outline" reason={why(rules.snapshot)} onClick={() => openSnapshot(w, img, rules.snapshot.reason)}>
                Create snapshot
              </Action>
            ) : (
              <Action
                icon="mdi:camera-outline"
                reason={
                  !rules.volumeSnapshot.ok
                    ? rules.volumeSnapshot.reason
                    : canSnapK8s === false
                    ? `Your role does not allow creating VolumeSnapshots in ${b.pvc?.metadata.namespace}`
                    : null
                }
                onClick={() => b.pvc && openVolumeSnapshot(b.pvc, b.pv, k.snapshotClasses.items)}
              >
                Take VolumeSnapshot
              </Action>
            )}
            <Action icon="mdi:arrow-expand-horizontal" reason={why(rules.resize)} onClick={() => openGrow(w, img, rules.resize.reason)}>
              Grow
            </Action>
            {img.parent && (
              <Action icon="mdi:layers-off-outline" reason={why(rules.flatten)} onClick={flatten}>
                Flatten
              </Action>
            )}
            <Action icon="mdi:delete-clock-outline" color="error" reason={why(rules.trash)} onClick={trash}>
              Move to trash
            </Action>
          </>
        )
      }
    >
      <LiveGate>
        {one.loading ? (
          <Loading label="Reading the image…" />
        ) : !img ? (
          <Panel>
            <Empty icon="mdi:harddisk-remove" title={`No image ${spec}`} action={<RLink to={nav.href('rbd', pool)}>Images of {pool}</RLink>}>
              {one.error ?? 'Ceph has no image with this name here. It may have been moved to the trash or deleted.'}
            </Empty>
          </Panel>
        ) : (
          <>
            <ImageBand img={img} one={one} b={b} />
            {b.csi && (
              <Notice tone="idle" title="The Ceph-CSI driver owns this image">
                Snapshots, growing and deletion go through Kubernetes (VolumeSnapshots, the claim’s requested size, deleting the claim), so the
                PersistentVolume and Ceph stay in step. Raw RBD snapshots would block the volume’s deletion.
              </Notice>
            )}
            {decodeFlags(img.flags).length > 0 && (
              <Notice tone="warn" title={`Flags: ${decodeFlags(img.flags).join(', ')}`}>
                The object map is invalid: usage and diffs are slow or wrong until it is rebuilt (rbd object-map rebuild {spec}).
              </Notice>
            )}
            <SnapshotsPanel w={w} img={img} one={one} rules={rules!} pools={pools} live={live} csi={b.csi} />
            <Grid min={560}>
              <InfoPanel img={img} pool={pool} ns={ns} />
              <UsePanel img={img} b={b} />
            </Grid>
            <Grid min={560}>
              <FeaturesPanel img={img} />
              <LineagePanel img={img} pool={pool} ns={ns} />
            </Grid>
          </>
        )}
      </LiveGate>
    </Page>
  );
}

/* --------------------------------------------------------- the band */

function ImageBand({ img, one, b }: { img: RbdImage; one: RbdOne; b: ImageBinding }) {
  const t = useTokens();
  const head = one.du?.byImage.get(img.name)?.used;
  const snapUsed = img.snaps.reduce((n, s) => n + (one.du?.bySnap.get(`${img.name}@${s.name}`) ?? 0), 0);
  const total = head !== undefined ? head + snapUsed : undefined;
  const busy = inUse(img, b);
  return (
    <Band>
      <Box sx={{ display: 'flex', gap: { xs: 2, md: 4 }, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ fontSize: 16, fontWeight: 600, color: t.basaltText }}>Core sample</Box>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: t.basaltText, fontSize: 13.5 }}>
              <StateLabel tone={busy ? 'ok' : 'idle'}>{busy ? `In use by ${plural(img.watchers?.length || b.pods.length, 'client')}` : 'Idle: no client has it open'}</StateLabel>
            </Box>
          </Box>
          <CoreSample
            length={img.size}
            label={`${bytes(img.size)} provisioned${total !== undefined ? `, ${bytes(total)} written` : ''}${snapUsed ? `, ${bytes(snapUsed)} of it before the last snapshot` : ''}`}
            parts={[
              ...(snapUsed ? [{ key: 'snaps', label: `Written before the last snapshot ${bytes(snapUsed)}`, value: snapUsed, fill: '#9C7BD6', banded: true }] : []),
              ...(head !== undefined ? [{ key: 'head', label: `Written ${snapUsed ? 'since the last snapshot ' : ''}${bytes(head)}`, value: head, fill: '#5B97EA' }] : []),
            ]}
            ticks={['0', bytes(img.size / 2), bytes(img.size)]}
          />
          <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', fontSize: 12.5, color: t.basaltMuted, ...tabular }}>
            {snapUsed > 0 && (
              <Swatch color="#9C7BD6" banded>
                Kept by snapshots {bytes(snapUsed)}
              </Swatch>
            )}
            <Swatch color="#5B97EA">
              {snapUsed > 0 ? 'Changed since the last snapshot' : 'Written'} {head !== undefined ? bytes(head) : '—'}
            </Swatch>
            <Swatch color="rgba(255,255,255,0.18)">Unwritten {total !== undefined ? bytes(Math.max(0, img.size - total)) : '—'}</Swatch>
          </Box>
        </Box>
        <Box sx={{ flex: '0 1 420px', ml: { xs: 0, lg: 'auto' }, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2 }}>
          <BandFigure value={bytes(img.size)} label="Provisioned" sub={`${count(img.numObjs)} objects of ${bytes(img.objSize)}`} />
          <BandFigure value={total !== undefined ? bytes(total) : '—'} label="Written" sub={total !== undefined && img.size ? `${pct(total / img.size)} of provisioned` : 'reading usage…'} />
          <BandFigure value={img.snaps.length} label={img.snaps.length === 1 ? 'Snapshot' : 'Snapshots'} sub={snapUsed ? `keep ${bytes(snapUsed)}` : undefined} />
          <BandFigure value={img.children.length} label={img.children.length === 1 ? 'Clone' : 'Clones'} sub={img.parent ? `clone of ${img.parent.image}` : 'not a clone'} />
        </Box>
      </Box>
    </Band>
  );
}

function Swatch({ color, banded, children }: { color: string; banded?: boolean; children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box
        component="span"
        aria-hidden
        sx={{ width: 11, height: 11, borderRadius: '3px', background: banded ? `repeating-linear-gradient(90deg, ${color} 0 2px, ${color}55 2px 4px)` : color }}
      />
      {children}
    </Box>
  );
}

/* ------------------------------------------------------- snapshots */

function SnapshotsPanel({
  w,
  img,
  one,
  rules,
  pools,
  live,
  csi,
}: {
  w: RbdWhere;
  img: RbdImage;
  one: RbdOne;
  rules: ImageRules;
  pools: ReturnType<typeof useRbdPools>;
  live: string | null;
  csi: boolean;
}) {
  const t = useTokens();
  const nav = useNav();
  const tip = (v: { ok: boolean; reason?: string }, label: string) => live ?? (v.ok ? label : `${label}: ${v.reason}`);
  const rollback = async (s: RbdSnap) => {
    const ok = await confirm({
      title: `Roll back ${img.name} to ${s.name}`,
      danger: true,
      typeToConfirm: img.name,
      confirm: 'Roll back',
      body: <p>The image is rewritten to look exactly as it did when {s.name} was taken.</p>,
      consequences: [
        <b key="lost">{rules.rollback(s).reason}</b>,
        'Nothing may open the image until the rollback ends; it takes longer the more has changed.',
        'The snapshot itself stays.',
      ],
    });
    if (ok) await rbdOps.snapRollback(w, img.name, s.name).catch(() => undefined);
  };
  const remove = async (s: RbdSnap) => {
    const ok = await confirm({
      title: `Delete snapshot ${s.name}`,
      danger: true,
      typeToConfirm: s.name,
      confirm: 'Delete snapshot',
      consequences: [
        `The point in time ${s.time ? new Date(s.time).toLocaleString() : ''} is gone for good; ${img.name} itself does not change.`,
        'Blocks that neither the image nor another snapshot still needs are freed in the background.',
      ],
    });
    if (ok) await rbdOps.snapRemove(w, img.name, s.name).catch(() => undefined);
  };
  const protect = (s: RbdSnap, on: boolean) => rbdOps.snapProtect(w, img.name, s.name, on).catch(() => undefined);
  const cols: Col<RbdSnap>[] = [
    { id: 'name', header: 'Snapshot', cell: s => <Mono>{s.name}</Mono>, sort: s => s.name, width: 280 },
    { id: 'time', header: 'Taken', cell: s => <When at={s.time} />, sort: s => s.time ?? 0 },
    { id: 'size', header: 'Image size then', cell: s => bytes(s.size), sort: s => s.size, align: 'right' },
    {
      id: 'held',
      header: 'Written since the previous',
      cell: s => bytes(one.du?.bySnap.get(`${img.name}@${s.name}`)),
      sort: s => one.du?.bySnap.get(`${img.name}@${s.name}`) ?? 0,
      align: 'right',
      minWidth: 900,
    },
    {
      id: 'prot',
      header: 'Protected',
      cell: s => {
        const k = childrenOf(img, s.name, { pool: w.pool, ns: w.ns }, one.children);
        return (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {s.protected ? <Tag>protected</Tag> : <Box component="span" sx={{ color: t.muted }}>No</Box>}
            {k.length > 0 && <Tag>{plural(k.length, 'clone')}</Tag>}
            {s.nsType !== null && s.nsType !== 0 && <Tag>{['user', 'group', 'trash', 'mirror'][s.nsType] ?? 'system'}</Tag>}
          </Box>
        );
      },
      sort: s => (s.protected ? 1 : 0),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      width: 190,
      cell: s => {
        const p = s.protected ? rules.unprotect(s) : rules.protect(s);
        return (
          <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'flex-end' }}>
            <IconAction
              icon={s.protected ? 'mdi:lock-open-variant-outline' : 'mdi:lock-outline'}
              label={tip(p, s.protected ? 'Unprotect' : 'Protect')}
              disabled={!!live || !p.ok}
              onClick={() => protect(s, !s.protected)}
            />
            <IconAction
              icon="mdi:content-copy"
              label={tip(rules.clone(s), 'Clone into a new image')}
              disabled={!!live || !rules.clone(s).ok}
              onClick={() =>
                openClone(w, img, s.name, pools, [], (p2, n2, name) => nav.go('rbd', p2, name, n2 || undefined))
              }
            />
            <IconAction icon="mdi:history" label={tip(rules.rollback(s), 'Roll back the image to it')} disabled={!!live || !rules.rollback(s).ok} onClick={() => rollback(s)} />
            <IconAction icon="mdi:delete-outline" label={tip(rules.removeSnap(s), 'Delete')} disabled={!!live || !rules.removeSnap(s).ok} onClick={() => remove(s)} />
          </Box>
        );
      },
    },
  ];
  return (
    <Panel dense title={`Snapshots${img.snaps.length ? ` (${img.snaps.length})` : ''}`} icon="mdi:camera-burst">
      <DataTable
        label="Snapshots"
        rows={img.snaps}
        columns={cols}
        rowKey={s => String(s.id)}
        initialSort={{ id: 'time', dir: 'desc' }}
        empty={
          <Box sx={{ px: 2, py: 1.5, color: t.muted, fontSize: 13.5 }}>
            {csi
              ? 'No RBD snapshots. Take a VolumeSnapshot of the claim instead: Kubernetes tracks it and can restore it as a new volume.'
              : 'No snapshots yet. A snapshot keeps this point in time: roll back to it, or clone it into a new image.'}
          </Box>
        }
      />
    </Panel>
  );
}

/* ------------------------------------------------------- the panels */

function InfoPanel({ img, pool, ns }: { img: RbdImage; pool: string; ns: string }) {
  const c = useCeph();
  const dataPool = img.dataPoolId !== null && img.dataPoolId >= 0 ? c.core.pools.find(p => p.id === img.dataPoolId) : undefined;
  const ops = decodeOpFeatures(img.opFeatures);
  return (
    <Panel title="Details" icon="mdi:information-outline">
      <KV
        rows={[
          ['Image id', <Mono key="id">{img.id}</Mono>],
          ['Pool', ns ? `${pool}, namespace ${ns}` : pool],
          dataPool && dataPool.name !== pool && ['Data pool', <Mono key="dp">{dataPool.name}</Mono>],
          ['Size', `${bytes(img.size)} (${img.size.toLocaleString('en-US')} bytes)`],
          ['Objects', `${count(img.numObjs)} of ${bytes(img.objSize)} (order ${img.order})`],
          ['Block prefix', <Mono key="bp">{img.prefix}</Mono>],
          ['Created', img.created ? <When at={img.created} /> : '—'],
          ['Modified', img.modified ? <When at={img.modified} /> : '—'],
          ops.length > 0 && ['Operation features', ops.join(', ')],
        ]}
      />
    </Panel>
  );
}

function FeaturesPanel({ img }: { img: RbdImage }) {
  const t = useTokens();
  const f = decodeFeatures(img.features);
  return (
    <Panel title="Features" icon="mdi:puzzle-outline">
      {f.length ? (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}>
          {f.map(x => (
            <Box component="li" key={x.bit} sx={{ fontSize: 13.5 }}>
              <Mono>{x.name}</Mono>
              <Box sx={{ color: t.muted, fontSize: 12.5 }}>{x.about}</Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box sx={{ color: t.muted, fontSize: 13.5 }}>None: a plain image (no clones, no object map).</Box>
      )}
    </Panel>
  );
}

function LineagePanel({ img, pool, ns }: { img: RbdImage; pool: string; ns: string }) {
  const t = useTokens();
  return (
    <Panel title="Clone lineage" icon="mdi:source-branch">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, fontSize: 13.5 }}>
        <Box>
          <Box sx={{ color: t.muted, fontSize: 12.5, mb: 0.25 }}>Parent</Box>
          {img.parent ? (
            <span>
              <RLink to={imageHref(img.parent.pool, img.parent.image, img.parent.ns)}>
                <Mono>{`${img.parent.pool}/${img.parent.ns ? `${img.parent.ns}/` : ''}${img.parent.image}`}</Mono>
              </RLink>{' '}
              at snapshot <Mono>{img.parent.snap}</Mono>. Unchanged blocks are read from there until the image is flattened.
            </span>
          ) : (
            <Box component="span" sx={{ color: t.muted }}>
              None: {img.name} is not a clone.
            </Box>
          )}
        </Box>
        <Box>
          <Box sx={{ color: t.muted, fontSize: 12.5, mb: 0.25 }}>Clones of its snapshots</Box>
          {img.children.length ? (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {img.children.map(ch => (
                <li key={`${ch.pool}/${ch.ns}/${ch.image}`}>
                  <RLink to={imageHref(ch.pool, ch.image, ch.ns)}>
                    <Mono>{ch.pool === pool && (ch.ns ?? '') === ns ? ch.image : `${ch.pool}/${ch.ns ? `${ch.ns}/` : ''}${ch.image}`}</Mono>
                  </RLink>
                  {ch.trash ? ' (in the trash)' : ''}
                </li>
              ))}
            </Box>
          ) : (
            <Box component="span" sx={{ color: t.muted }}>
              None.
            </Box>
          )}
        </Box>
      </Box>
    </Panel>
  );
}

function UsePanel({ img, b }: { img: RbdImage; b: ImageBinding }) {
  const t = useTokens();
  const w = img.watchers ?? [];
  return (
    <Panel title="Who uses it" icon="mdi:link-variant">
      <KV
        rows={[
          [
            'Watchers',
            w.length ? (
              <Box key="w" sx={{ display: 'flex', flexDirection: 'column' }}>
                {w.map(x => (
                  <Mono key={`${x.id}-${x.addr}`}>{`client.${x.id} at ${x.addr}`}</Mono>
                ))}
              </Box>
            ) : (
              'None: no client has the image open'
            ),
          ],
          [
            'PersistentVolume',
            b.pv ? (
              <span key="pv">
                <Mono>{b.pv.metadata.name}</Mono>
                <Box component="span" sx={{ color: t.muted }}>
                  {' '}
                  {b.pv.spec?.capacity?.storage}, {b.pv.spec?.storageClassName ? `class ${b.pv.spec.storageClassName}, ` : ''}reclaim{' '}
                  {b.pv.spec?.persistentVolumeReclaimPolicy}
                </Box>
              </span>
            ) : b.csi ? (
              'None found: the image looks like a CSI volume, but no PersistentVolume points at it (left behind?)'
            ) : (
              'None: created outside Kubernetes'
            ),
          ],
          b.pvc && [
            'Claim',
            <span key="pvc">
              <Mono>{`${b.pvc.metadata.namespace}/${b.pvc.metadata.name}`}</Mono>{' '}
              <StateLabel tone={phaseTone(b.pvc.status?.phase)} size="sm">
                {b.pvc.status?.phase ?? '—'}
              </StateLabel>
            </span>,
          ],
          b.pv &&
            b.pods.length > 0 && [
              'Pods',
              <Box key="pods" sx={{ display: 'flex', flexDirection: 'column' }}>
                {b.pods.map(p => (
                  <span key={p.metadata.uid ?? p.metadata.name}>
                    <Mono>{`${p.metadata.namespace}/${p.metadata.name}`}</Mono>
                    <Box component="span" sx={{ color: t.muted }}>
                      {' '}
                      on {p.spec?.nodeName ?? '—'}, {p.status?.phase}
                    </Box>
                  </span>
                ))}
              </Box>,
            ],
          b.vms.length > 0 && ['Virtual machines', <VmLinks key="vms" vms={b.vms} />],
        ]}
      />
    </Panel>
  );
}

/** VM names, linked to Hangar's VM page when Hangar is installed. */
export function VmLinks({ vms }: { vms: VmRef[] }) {
  return (
    <>
      {vms.map((v, i) => {
        const href = hangarVmHref(v.namespace, v.name);
        const label = `${v.namespace}/${v.name}${v.running ? '' : ' (stopped)'}`;
        return (
          <React.Fragment key={`${v.namespace}/${v.name}`}>
            {i > 0 && ', '}
            {href ? (
              <RLink to={href} title="Open in Hangar">
                {label}
              </RLink>
            ) : (
              label
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
