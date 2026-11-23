/*
 * One object store: gateways and endpoints on the band, then tabs for
 * the overview (pools, Rook resource, gateway pods), users (resources and
 * radosgw users, keys on request), buckets (radosgw-admin bucket stats) and
 * bucket claims.
 */

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { deleteStore, deleteUser } from '../../api/objectOps';
import { rookAttrs, useCan } from '../../api/permissions';
import { bytes, count, pct, plural } from '../../model/format';
import {
  Bucket,
  claimForBucket,
  Quota,
  storeClaims,
  storeClasses,
  storeDeleteBlockers,
  storeInfo,
  storePools,
  storeUsersOf,
  UserRow,
  userRows,
} from '../../model/object';
import { Obj } from '../../model/types';
import { LiveGate } from '../../shell/Gate';
import { poolHref, useNav } from '../../shell/nav';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Band, Empty, Grid, IconAction, KV, Meter, Mono, Notice, Page, Panel, Tag, ToolButton, When } from '../../ui/kit';
import { Mark, StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { Conditions, explain, PhaseLabel, PodList, podState } from '../cephfs/formkit';
import { BandFigure, Go } from '../cephfs/fsParts';
import { openCreateUser } from './objDialogs';
import { ClaimsPanel, ClassesPanel } from './ObjectView';
import { KeyCount, ShowKeys, StoreLive, useStoreLive } from './objParts';

const TABS = ['overview', 'users', 'buckets', 'claims'] as const;
type TabId = (typeof TABS)[number];
const TAB_LABEL: Record<TabId, string> = { overview: 'Overview', users: 'Users', buckets: 'Buckets', claims: 'Bucket claims' };

export function StoreDetail({ name, tab }: { name: string; tab?: string }) {
  const kube = useKube();
  const nav = useNav();
  const t = useTokens();
  const store = kube.objectStores.items.find(s => s.metadata.namespace === kube.ns && s.metadata.name === name);
  const live = useStoreLive(store);
  const canDelete = useCan(rookAttrs('delete', 'cephobjectstores', kube.ns));
  const current: TabId = (TABS as readonly string[]).includes(tab ?? '') ? (tab as TabId) : 'overview';

  if (!store)
    return (
      <Page title={name}>
        <Panel>
          <Empty
            icon="mdi:bucket-outline"
            title={kube.objectStores.loaded ? `No object store named ${name}` : 'Looking for the object store…'}
            action={
              <Action icon="mdi:arrow-left" onClick={() => nav.go('object')}>
                All object stores
              </Action>
            }
          >
            {kube.objectStores.loaded ? 'Rook has no CephObjectStore with this name. It may have been deleted.' : null}
          </Empty>
        </Panel>
      </Page>
    );

  const info = storeInfo(store, kube.rookPods.items);
  const deleting = !!store.metadata.deletionTimestamp;
  const onDelete = () => {
    const why = storeDeleteBlockers(store, kube.objectUsers.items, kube.bucketClaims.items, kube.storageClasses.items, live.buckets);
    if (why.length) return explain({ title: `${name} cannot be deleted yet`, lines: why });
    deleteStore(store, { onDone: () => nav.go('object') });
  };

  return (
    <Page
      title={name}
      subtitle="An S3 object store: its gateways and endpoints, pools, users, buckets and the bucket claims served from it."
      actions={
        <>
          <ToolButton icon="mdi:arrow-left" onClick={() => nav.go('object')}>
            All object stores
          </ToolButton>
          <Action
            icon="mdi:delete-outline"
            color="error"
            onClick={onDelete}
            reason={deleting ? 'Rook is deleting it' : canDelete ? null : 'Your role does not allow deleting object stores'}
          >
            Delete object store
          </Action>
        </>
      }
    >
      {deleting && (
        <Notice tone="move" title="Rook is deleting this object store">
          Rook removes it once no user, bucket or claim depends on it{store.status?.phase ? ` (phase ${store.status.phase})` : ''}.
        </Notice>
      )}
      <Band>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Box sx={{ fontSize: 18, fontWeight: 650 }}>
              <StateLabel tone={info.phase === 'Ready' ? 'ok' : info.phase ? 'move' : 'idle'}>
                <Box component="span" sx={{ fontSize: 18 }}>
                  {info.phase || 'Creating'}
                </Box>
              </StateLabel>
            </Box>
            <Box sx={{ color: t.basaltMuted, fontSize: 13.5 }}>
              {info.readyPods} of {info.instances} gateway{info.instances === 1 ? '' : 's'} ready
              {info.port ? `, HTTP on port ${info.port}` : ''}
              {info.securePort ? `, HTTPS on ${info.securePort}` : ''}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
            {info.pods.map(p => {
              const s = podState(p);
              return (
                <Box
                  key={p.metadata.name}
                  sx={{
                    minWidth: 200,
                    px: 1.25,
                    py: 1,
                    borderRadius: `${t.radius.panel}px`,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderLeft: `3px solid ${s.tone === 'ok' ? '#3BA57E' : s.tone === 'err' ? '#D3424F' : s.tone === 'move' ? '#4A86E0' : '#D9A02B'}`,
                    display: 'grid',
                    gap: 0.25,
                  }}
                >
                  <Box sx={{ fontSize: 12, color: t.basaltMuted }}>Gateway on {p.spec?.nodeName ?? 'no node yet'}</Box>
                  <Box sx={{ fontFamily: t.font.mono, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.metadata.name}</Box>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 13 }}>
                    <Mark tone={s.tone} size={8} />
                    {s.word}
                  </Box>
                </Box>
              );
            })}
            {!info.pods.length && <Box sx={{ fontSize: 13, color: t.basaltMuted }}>No gateway pod yet: Rook starts them once the pools and the zone exist.</Box>}
          </Box>
          <Box sx={{ fontSize: 13 }}>
            <Box component="span" sx={{ color: t.basaltMuted }}>
              Endpoint{' '}
            </Box>
            {info.endpoints.length ? (
              <Box component="span" sx={{ fontFamily: t.font.mono }}>
                {info.endpoints.join(', ')}
              </Box>
            ) : (
              <Box component="span" sx={{ color: t.basaltMuted }}>
                not reported yet
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 2, pt: 1.5, borderTop: `1px solid ${t.basaltEdge}` }}>
            <BandFigure value={live.buckets ? count(live.buckets.length) : '—'} label="buckets" />
            <BandFigure value={live.buckets ? count(live.buckets.reduce((n, b) => n + b.objects, 0)) : '—'} label="objects" />
            <BandFigure value={live.buckets ? bytes(live.buckets.reduce((n, b) => n + b.sizeBytes, 0)) : '—'} label="in buckets" />
            <BandFigure value={live.uids ? count(live.uids.length) : '—'} label="users" />
            <BandFigure value={count(storeClaims(store, kube.bucketClaims.items, kube.storageClasses.items).length)} label="bucket claims" />
          </Box>
        </Box>
      </Band>

      <Tabs
        value={current}
        onChange={(_, v) => nav.go('object', name, v === 'overview' ? undefined : v)}
        aria-label="Object store sections"
        sx={{ minHeight: 40, borderBottom: `1px solid ${t.rule}`, '& .MuiTab-root': { textTransform: 'none', minHeight: 40, fontSize: 14 } }}
      >
        {TABS.map(id => (
          <Tab key={id} value={id} label={TAB_LABEL[id]} />
        ))}
      </Tabs>

      {current === 'overview' && <OverviewTab store={store} />}
      {current === 'users' && <UsersTab store={store} live={live} />}
      {current === 'buckets' && <BucketsTab store={store} live={live} />}
      {current === 'claims' && <ClaimsTab store={store} />}
    </Page>
  );
}

/* ------------------------------------------------------------- overview */

function OverviewTab({ store }: { store: Obj }) {
  const kube = useKube();
  const ceph = useCeph();
  const t = useTokens();
  const info = storeInfo(store, kube.rookPods.items);
  const pools = storePools(store.metadata.name, ceph.core.pools);
  const gw = store.spec?.gateway ?? {};
  return (
    <Grid min={340}>
      <Panel title="Pools" icon="mdi:database-outline">
        <LiveGate compact>
          {pools.length ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              {pools
                .sort((a, b) => (b.usage?.stored ?? 0) - (a.usage?.stored ?? 0))
                .map(p => (
                  <Meter
                    key={p.id}
                    label={
                      <>
                        <Go to={poolHref(p.name)}>{p.name}</Go>
                        {p.name === '.rgw.root' && (
                          <Box component="span" sx={{ color: t.muted, fontWeight: 400 }}>
                            {' '}
                            shared
                          </Box>
                        )}
                      </>
                    }
                    used={p.usage?.stored}
                    total={(p.usage?.stored ?? 0) + (p.usage?.maxAvail ?? 0)}
                    format={bytes}
                    caption={`${p.type === 'erasure' && p.ec ? `Erasure ${p.ec.k}+${p.ec.m}` : `${p.size} replicas`}, ${count(p.usage?.objects ?? 0)} objects`}
                  />
                ))}
            </Box>
          ) : (
            <Box sx={{ fontSize: 13.5, color: t.muted }}>No pool yet: Rook creates {store.metadata.name}.rgw.* first.</Box>
          )}
        </LiveGate>
      </Panel>
      <Panel title="Rook resource" icon="mdi:file-cog-outline">
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <KV
            labelWidth={150}
            rows={[
              ['State', <PhaseLabel key="p" phase={info.phase} missing="Creating" />],
              ['Gateways', `${gw.instances ?? 1}${gw.port ? `, port ${gw.port}` : ''}${gw.securePort ? `, TLS ${gw.securePort}` : ''}`],
              ['Resources', resWords(gw.resources)],
              ['Service', <Mono key="s">{`rook-ceph-rgw-${store.metadata.name}`}</Mono>],
              ['Zone', info.zone || 'Its own realm, zone group and zone'],
              ['On delete', store.spec?.preservePoolsOnDelete ? 'Keep the pools' : 'Delete the pools'],
              ['Created', <When key="c" at={store.metadata.creationTimestamp} />],
            ]}
          />
          <Conditions cr={store} />
        </Box>
      </Panel>
      <Panel title="Gateway pods" icon="mdi:server-network">
        <PodList pods={info.pods} empty="No gateway pod yet." />
      </Panel>
    </Grid>
  );
}

function resWords(r: any): string {
  if (!r) return 'Not set';
  const req = [r.requests?.cpu && `${r.requests.cpu} CPU`, r.requests?.memory && `${r.requests.memory} memory`].filter(Boolean).join(', ');
  return [req && `asks ${req}`, r.limits?.memory && `limit ${r.limits.memory}`].filter(Boolean).join('; ') || 'Not set';
}

/* ---------------------------------------------------------------- users */

function quotaWords(q?: Quota): string {
  if (!q || !q.enabled) return 'None';
  const parts = [q.maxSizeBytes !== null && bytes(q.maxSizeBytes), q.maxObjects !== null && `${count(q.maxObjects)} objects`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Enabled, no limit';
}

function UsersTab({ store, live }: { store: Obj; live: StoreLive }) {
  const kube = useKube();
  const t = useTokens();
  const crs = storeUsersOf(store, kube.objectUsers.items);
  const rows = userRows(crs, live.uids, live.infos, live.buckets ?? []);
  const [sel, setSel] = React.useState<string | null>(null);
  const canCreate = useCan(rookAttrs('create', 'cephobjectstoreusers', kube.ns));
  const canDelete = useCan(rookAttrs('delete', 'cephobjectstoreusers', kube.ns));
  const current = rows.find(r => r.uid === sel) ?? null;
  const cols: Column<UserRow>[] = [
    { id: 'uid', header: 'User', cell: r => <Mono title={r.uid}>{r.uid}</Mono>, sort: r => r.uid, width: 300 },
    {
      id: 'by',
      header: 'Made by',
      cell: r => (r.cr ? 'User resource' : r.forClaim ? 'Bucket claim' : r.uid.startsWith('rgw-admin-ops') || r.uid.startsWith('dashboard') ? 'Rook' : 'Ceph'),
      sort: r => (r.cr ? 0 : r.forClaim ? 1 : 2),
    },
    { id: 'name', header: 'Display name', cell: r => r.rgw?.displayName || r.cr?.spec?.displayName || '—', minWidth: 900 },
    {
      id: 'state',
      header: 'State',
      cell: r =>
        r.rgw?.suspended ? (
          <StateLabel tone="warn">Suspended</StateLabel>
        ) : r.cr && !r.rgw ? (
          <PhaseLabel phase={r.cr.status?.phase} />
        ) : r.rgw ? (
          <StateLabel tone="ok">Active</StateLabel>
        ) : (
          '—'
        ),
    },
    { id: 'buckets', header: 'Buckets', align: 'right', cell: r => count(r.buckets), sort: r => r.buckets },
    { id: 'bytes', header: 'Stored', align: 'right', cell: r => bytes(r.bytes), sort: r => r.bytes },
    { id: 'keys', header: 'Keys', align: 'right', cell: r => (r.rgw ? <KeyCount n={r.rgw.keyCount} /> : '—'), minWidth: 800 },
    { id: 'caps', header: 'Admin caps', cell: r => (r.rgw?.caps.length ? r.rgw.caps.map(c => `${c.type}=${c.perm}`).join(', ') : 'None'), minWidth: 1000 },
  ];
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: current ? 'minmax(0, 1.6fr) minmax(360px, 1fr)' : '1fr' }, alignItems: 'start' }}>
      <Panel
        title="Users"
        icon="mdi:account-key-outline"
        dense
        actions={
          <Action icon="mdi:plus" onClick={() => openCreateUser(store.metadata.name)} reason={canCreate ? null : 'Your role does not allow creating object store users'}>
            Create user
          </Action>
        }
      >
        <LiveGate compact>
          {live.error && (
            <Box sx={{ p: 1.5 }}>
              <Notice tone="err" title="radosgw-admin did not answer">
                {live.error}
              </Notice>
            </Box>
          )}
        </LiveGate>
        <DataTable
          label="Users"
          rows={rows}
          columns={cols}
          rowKey={r => r.uid}
          activeKey={sel ?? undefined}
          onOpen={r => setSel(r.uid === sel ? null : r.uid)}
          empty={
            <Empty icon="mdi:account-key-outline" title={live.loading ? 'Reading the users…' : 'No user'}>
              Users have their own S3 keys. Bucket claims make theirs; create one for tools that need their own.
            </Empty>
          }
        />
      </Panel>
      {current && (
        <Panel
          title={
            <>
              User <Mono>{current.uid}</Mono>
            </>
          }
          icon="mdi:account-outline"
          actions={<IconAction icon="mdi:close" label="Close" onClick={() => setSel(null)} />}
        >
          <Box sx={{ display: 'grid', gap: 2 }}>
            <KV
              labelWidth={130}
              rows={[
                ['Display name', current.rgw?.displayName || current.cr?.spec?.displayName || '—'],
                current.rgw?.email ? ['Email', current.rgw.email] : null,
                ['State', current.rgw ? (current.rgw.suspended ? 'Suspended' : 'Active') : current.cr?.status?.phase ?? '—'],
                ['Buckets', `${count(current.buckets)} of at most ${current.rgw ? count(current.rgw.maxBuckets) : '—'}`],
                ['Stored', `${bytes(current.bytes)}, ${count(current.objects)} objects`],
                ['User quota', quotaWords(current.rgw?.userQuota)],
                ['Bucket quota', quotaWords(current.rgw?.bucketQuota)],
                ['Admin caps', current.rgw?.caps.length ? current.rgw.caps.map(c => `${c.type}=${c.perm}`).join(', ') : 'None'],
                ['Keys', current.rgw ? `${current.rgw.keyCount} S3, ${current.rgw.swiftKeyCount} Swift${current.rgw.subusers ? `, ${current.rgw.subusers} subusers` : ''}` : '—'],
                current.rgw?.defaultPlacement ? ['Placement', current.rgw.defaultPlacement] : null,
                current.cr ? ['Resource', <Mono key="r">{`${current.cr.metadata.namespace}/${current.cr.metadata.name}`}</Mono>] : null,
              ]}
            />
            {current.cr?.status?.info?.secretName ? (
              <ShowKeys namespace={current.cr.metadata.namespace ?? kube.ns} secret={current.cr.status.info.secretName} what={`user ${current.uid}`} />
            ) : current.cr ? (
              <Box sx={{ fontSize: 13, color: t.muted }}>Rook has not written the key Secret yet.</Box>
            ) : (
              <Box sx={{ fontSize: 13, color: t.muted }}>
                {current.forClaim ? 'The bucket claim Secret holds this user’s keys: see Bucket claims.' : 'No Kubernetes Secret holds this user’s keys: Cairn does not show keys from Ceph.'}
              </Box>
            )}
            {current.cr && (
              <Box>
                <Action
                  icon="mdi:delete-outline"
                  color="error"
                  onClick={() => {
                    if (current.buckets)
                      return explain({
                        title: `${current.uid} still owns buckets`,
                        lines: [`It owns ${plural(current.buckets, 'bucket')}. Ceph refuses to remove a user with buckets: empty and delete them, or move them to another user, first.`],
                      });
                    deleteUser(current.cr as Obj, { onDone: () => setSel(null) });
                  }}
                  reason={canDelete ? null : 'Your role does not allow deleting object store users'}
                >
                  Delete user
                </Action>
              </Box>
            )}
          </Box>
        </Panel>
      )}
    </Box>
  );
}

/* -------------------------------------------------------------- buckets */

function BucketsTab({ store, live }: { store: Obj; live: StoreLive }) {
  const kube = useKube();
  const nav = useNav();
  const claims = storeClaims(store, kube.bucketClaims.items, kube.storageClasses.items);
  const cols: Column<Bucket>[] = [
    { id: 'name', header: 'Bucket', cell: b => <Mono title={b.name}>{b.name}</Mono>, sort: b => b.name, width: 280 },
    { id: 'owner', header: 'Owner', cell: b => <Mono title={b.owner}>{b.owner}</Mono>, sort: b => b.owner, width: 220 },
    { id: 'objects', header: 'Objects', align: 'right', cell: b => count(b.objects), sort: b => b.objects },
    { id: 'size', header: 'Size', align: 'right', cell: b => bytes(b.sizeBytes), sort: b => b.sizeBytes },
    {
      id: 'quota',
      header: 'Quota',
      align: 'right',
      cell: b => (b.quota.enabled && b.quota.maxSizeBytes ? `${pct(b.sizeBytes / b.quota.maxSizeBytes)} of ${bytes(b.quota.maxSizeBytes)}` : quotaWords(b.quota)),
      minWidth: 900,
    },
    { id: 'shards', header: 'Index shards', align: 'right', cell: b => count(b.shards), sort: b => b.shards, minWidth: 1500 },
    { id: 'placement', header: 'Placement', cell: b => b.placement || '—', minWidth: 1400 },
    {
      id: 'claim',
      header: 'Claim',
      cell: b => {
        const c = claimForBucket(b.name, claims);
        return c ? (
          <Tag tone="accent">
            <Mono>{`${c.namespace}/${c.name}`}</Mono>
          </Tag>
        ) : (
          '—'
        );
      },
    },
    { id: 'created', header: 'Created', cell: b => <When at={b.created} />, sort: b => b.created ?? 0, minWidth: 1100 },
  ];
  return (
    <Panel title="Buckets" icon="mdi:bucket-outline" dense>
      <LiveGate compact>
        {live.error && (
          <Box sx={{ p: 1.5 }}>
            <Notice tone="err" title="radosgw-admin did not answer">
              {live.error}
            </Notice>
          </Box>
        )}
        <DataTable
          label="Buckets"
          rows={live.buckets ?? []}
          columns={cols}
          rowKey={b => `${b.tenant}/${b.name}`}
          onOpen={b => claimForBucket(b.name, claims) && nav.go('object', store.metadata.name, 'claims')}
          empty={
            <Empty icon="mdi:bucket-outline" title={live.loading || !live.buckets ? 'Reading the buckets…' : 'No bucket'}>
              Buckets come from bucket claims or from S3 clients using a user’s keys.
            </Empty>
          }
        />
      </LiveGate>
    </Panel>
  );
}

/* --------------------------------------------------------------- claims */

function ClaimsTab({ store }: { store: Obj }) {
  const kube = useKube();
  const t = useTokens();
  const classes = storeClasses(store, kube.storageClasses.items);
  const claims = storeClaims(store, kube.bucketClaims.items, kube.storageClasses.items);
  const [sel, setSel] = React.useState<string | null>(null);
  const current = claims.find(c => `${c.namespace}/${c.name}` === sel) ?? null;
  return (
    <>
      <ClassesPanel classes={classes} claims={claims} store={store.metadata.name} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: current ? 'minmax(0, 1.6fr) minmax(360px, 1fr)' : '1fr' }, alignItems: 'start' }}>
        <ClaimsPanel claims={claims} store={store.metadata.name} activeKey={sel ?? undefined} onOpen={c => setSel(`${c.namespace}/${c.name}` === sel ? null : `${c.namespace}/${c.name}`)} />
        {current && (
          <Panel
            title={
              <>
                Claim <Mono>{`${current.namespace}/${current.name}`}</Mono>
              </>
            }
            icon="mdi:bucket-outline"
            actions={<IconAction icon="mdi:close" label="Close" onClick={() => setSel(null)} />}
          >
            <Box sx={{ display: 'grid', gap: 2 }}>
              <KV
                labelWidth={130}
                rows={[
                  ['State', <PhaseLabel key="p" phase={current.phase} missing="Pending" />],
                  ['Bucket', current.bucketName ? <Mono key="b">{current.bucketName}</Mono> : 'Not created yet'],
                  ['StorageClass', <Mono key="c">{current.storageClass}</Mono>],
                  ['ObjectBucket', current.objectBucket ? <Mono key="o">{current.objectBucket}</Mono> : '—'],
                  ['ConfigMap', <Mono key="m">{`${current.namespace}/${current.configMapName}`}</Mono>],
                  ['Created', <When key="w" at={current.obc.metadata.creationTimestamp} />],
                ]}
              />
              {current.phase === 'Bound' ? (
                <ShowKeys namespace={current.namespace} secret={current.secretName} what={`claim ${current.name}`} />
              ) : (
                <Box sx={{ fontSize: 13, color: t.muted }}>The keys appear in the Secret {current.secretName} once the claim is bound.</Box>
              )}
            </Box>
          </Panel>
        )}
      </Box>
    </>
  );
}
