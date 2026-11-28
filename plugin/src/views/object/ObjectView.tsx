/*
 * Object storage (RGW): the stores as strata on the basalt band, the
 * bucket StorageClasses and the bucket claims of every namespace; one store
 * in detail at /ceph/object/<store>/<tab>.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { deleteBucketClass, deleteClaim } from '../../api/objectOps';
import { rookAttrs, useCan } from '../../api/permissions';
import { bytes, count, plural } from '../../model/format';
import { Claim, claimInfo, classStore, isBucketClass, storeInfo, storePools } from '../../model/object';
import { Obj } from '../../model/types';
import { hrefFor, useNav } from '../../shell/nav';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Band, Empty, Figure, IconAction, Mono, Page, Panel } from '../../ui/kit';
import { Mark } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { PhaseLabel, podState } from '../cephfs/formkit';
import { Go } from '../cephfs/fsParts';
import { openCreateClaim, openCreateClass, openCreateStore } from './objDialogs';
import { useStoreLive } from './objParts';
import { StoreDetail } from './StoreDetail';

export function ObjectView({ store, tab }: { store?: string; tab?: string }) {
  if (store) return <StoreDetail key={store} name={store} tab={tab} />;
  return <StoreList />;
}

function StoreList() {
  const kube = useKube();
  const t = useTokens();
  const canCreate = useCan(rookAttrs('create', 'cephobjectstores', kube.ns));
  const stores = kube.objectStores.items.filter(s => s.metadata.namespace === kube.ns);
  const nothing = kube.objectStores.loaded && !stores.length;
  const classes = kube.storageClasses.items.filter(isBucketClass);
  const claims = kube.bucketClaims.items.map(o => claimInfo(o, kube.storageClasses.items));
  const createStoreBtn = (
    <Action icon="mdi:plus" variant="contained" onClick={openCreateStore} reason={canCreate ? null : 'Your role does not allow creating object stores'}>
      Create object store
    </Action>
  );
  return (
    <Page
      title="Object storage"
      subtitle="S3-compatible object stores (Ceph RADOS Gateway): their gateways, users and buckets, and the bucket claims Kubernetes apps make."
      actions={createStoreBtn}
    >
      {nothing ? (
        <Panel>
          <Empty icon="mdi:bucket-outline" title="No object store yet" action={createStoreBtn}>
            An object store serves S3 over HTTP from gateway pods Rook runs. Apps get buckets with ObjectBucketClaims, like volumes with PVCs; tools get users
            with their own keys.
          </Empty>
        </Panel>
      ) : (
        <Band>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Box component="h2" sx={{ m: 0, fontSize: 18, fontWeight: 650 }}>
              {plural(stores.length, 'object store')}
            </Box>
            <Box sx={{ color: t.basaltMuted, fontSize: 13.5 }}>
              {plural(claims.length, 'bucket claim')}, {plural(kube.objectUsers.items.length, 'user resource')}
            </Box>
          </Box>
          <Box sx={{ display: 'grid', gap: 1.25 }}>
            {stores.map(s => (
              <StoreStratum key={s.metadata.name} store={s} />
            ))}
          </Box>
        </Band>
      )}
      {(!nothing || classes.length > 0) && <ClassesPanel classes={classes} claims={claims} />}
      {(!nothing || claims.length > 0) && <ClaimsPanel claims={claims} />}
    </Page>
  );
}

function StoreStratum({ store }: { store: Obj }) {
  const t = useTokens();
  const kube = useKube();
  const ceph = useCeph();
  const info = storeInfo(store, kube.rookPods.items);
  const live = useStoreLive(store, false);
  const data = ceph.core.pools.find(p => p.name === `${info.name}.rgw.buckets.data`);
  const pools = storePools(info.name, ceph.core.pools).filter(p => p.name !== '.rgw.root');
  const ready = info.phase === 'Ready';
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(200px, 1fr) minmax(0, 2fr) minmax(300px, 1.3fr)' },
        gap: 2,
        alignItems: 'center',
        p: 1.5,
        borderRadius: `${t.radius.panel}px`,
        border: `1px solid ${t.basaltEdge}`,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Go to={hrefFor('object', info.name)} sx={{ fontSize: 16, fontWeight: 650 }}>
          {info.name}
        </Go>
        <Box sx={{ mt: 0.5 }}>
          <PhaseLabel phase={info.phase} missing="Creating" />
        </Box>
      </Box>
      <Box sx={{ minWidth: 0, display: 'grid', gap: 0.75 }}>
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
          {info.pods.map(p => {
            const s = podState(p);
            return (
              <Box
                key={p.metadata.name}
                title={`${p.metadata.name} on ${p.spec?.nodeName ?? '—'}: ${s.word}`}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.4, borderRadius: `${t.radius.small}px`, border: '1px solid rgba(255,255,255,0.12)', fontSize: 12.5 }}
              >
                <Mark tone={s.tone} size={8} />
                {p.spec?.nodeName?.split('.')[0] ?? 'pending'}
              </Box>
            );
          })}
          <Box sx={{ fontSize: 12.5, color: t.basaltMuted }}>
            {info.readyPods} of {info.instances} gateway{info.instances === 1 ? '' : 's'} ready
          </Box>
        </Box>
        <Box sx={{ fontSize: 12.5, color: t.basaltMuted, overflowWrap: 'anywhere' }}>
          {info.endpoints.length ? <Box component="span" sx={{ fontFamily: t.font.mono }}>{info.endpoints.join(', ')}</Box> : 'No endpoint reported yet'}
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5 }}>
        <Figure onBand size={20} value={live.buckets ? count(live.buckets.length) : '—'} label="buckets" />
        <Figure onBand size={20} value={live.uids ? count(live.uids.length) : '—'} label="users" />
        <Figure onBand size={20} value={data?.usage ? bytes(data.usage.stored) : ready ? bytes(0) : '—'} label={`stored, ${plural(pools.length, 'pool')}`} />
      </Box>
    </Box>
  );
}

export function ClassesPanel({ classes, claims, store }: { classes: Obj[]; claims: Claim[]; store?: string }) {
  const kube = useKube();
  const canCreate = useCan({ verb: 'create', group: 'storage.k8s.io', resource: 'storageclasses' });
  const canDelete = useCan({ verb: 'delete', group: 'storage.k8s.io', resource: 'storageclasses' });
  const hasStore = kube.objectStores.items.some(s => s.metadata.namespace === kube.ns);
  const cols: Column<Obj>[] = [
    { id: 'name', header: 'StorageClass', cell: c => <Mono>{c.metadata.name}</Mono>, sort: c => c.metadata.name },
    {
      id: 'store',
      header: 'Object store',
      cell: c => {
        const s = classStore(c);
        return s ? <Go to={hrefFor('object', s.name)}>{s.name}</Go> : '—';
      },
      sort: c => classStore(c)?.name ?? '',
    },
    { id: 'reclaim', header: 'On claim delete', cell: c => (c.reclaimPolicy === 'Retain' ? 'Keep the bucket' : 'Delete the bucket'), sort: c => c.reclaimPolicy ?? '' },
    { id: 'claims', header: 'Claims', align: 'right', cell: c => count(claims.filter(x => x.storageClass === c.metadata.name).length) },
    { id: 'prov', header: 'Provisioner', cell: c => <Mono muted>{c.provisioner}</Mono>, minWidth: 1000 },
    {
      id: 'act',
      header: '',
      align: 'right',
      width: 48,
      cell: c => (
        <IconAction
          icon="mdi:delete-outline"
          label={canDelete ? `Delete ${c.metadata.name}` : 'Your role does not allow deleting StorageClasses'}
          disabled={!canDelete}
          onClick={() => deleteBucketClass(c, claims.filter(x => x.storageClass === c.metadata.name).length)}
        />
      ),
    },
  ];
  return (
    <Panel
      title="Bucket StorageClasses"
      icon="mdi:layers-outline"
      dense
      actions={
        <Action icon="mdi:plus" onClick={() => openCreateClass(store)} reason={!hasStore ? 'Create an object store first' : canCreate ? null : 'Your role does not allow creating StorageClasses'}>
          Create StorageClass
        </Action>
      }
    >
      <DataTable
        label="Bucket StorageClasses"
        rows={classes}
        columns={cols}
        rowKey={c => c.metadata.name}
        empty={
          <Empty icon="mdi:layers-outline" title="No bucket StorageClass">
            Bucket claims name a StorageClass whose provisioner is {kube.ns}.ceph.rook.io/bucket. Create one to let apps claim buckets.
          </Empty>
        }
      />
    </Panel>
  );
}

export function ClaimsPanel({ claims, store, onOpen, activeKey }: { claims: Claim[]; store?: string; onOpen?: (c: Claim) => void; activeKey?: string }) {
  const kube = useKube();
  const nav = useNav();
  const hasClass = kube.storageClasses.items.some(isBucketClass);
  const cols: Column<Claim>[] = [
    { id: 'name', header: 'Claim', cell: c => <Mono>{`${c.namespace}/${c.name}`}</Mono>, sort: c => `${c.namespace}/${c.name}` },
    { id: 'phase', header: 'State', cell: c => <PhaseLabel phase={c.phase} missing="Pending" />, sort: c => c.phase },
    { id: 'bucket', header: 'Bucket', cell: c => (c.bucketName ? <Mono title={c.bucketName}>{c.bucketName}</Mono> : '—'), sort: c => c.bucketName, width: 300 },
    { id: 'class', header: 'StorageClass', cell: c => <Mono>{c.storageClass}</Mono>, sort: c => c.storageClass, minWidth: 900 },
    ...(store
      ? []
      : [{ id: 'store', header: 'Object store', cell: (c: Claim) => (c.store ? <Go to={hrefFor('object', c.store.name)}>{c.store.name}</Go> : '—'), minWidth: 800 }]),
    { id: 'secret', header: 'Secret and ConfigMap', cell: c => <Mono muted>{c.secretName}</Mono>, minWidth: 1100 },
    {
      id: 'act',
      header: '',
      align: 'right',
      width: 48,
      cell: c => <ClaimDelete claim={c} />,
    },
  ];
  return (
    <Panel
      title="Bucket claims"
      icon="mdi:bucket-outline"
      dense
      actions={
        <Action icon="mdi:plus" onClick={() => openCreateClaim(store)} reason={hasClass ? null : 'Create a bucket StorageClass first'}>
          Create claim
        </Action>
      }
    >
      <DataTable
        label="Bucket claims"
        rows={claims}
        columns={cols}
        rowKey={c => `${c.namespace}/${c.name}`}
        activeKey={activeKey}
        onOpen={onOpen ?? (c => c.store && nav.go('object', c.store.name, 'claims'))}
        empty={
          <Empty icon="mdi:bucket-outline" title="No bucket claim">
            An app asks for a bucket with an ObjectBucketClaim in its namespace; its pods read the address and keys from a ConfigMap and a Secret named after
            the claim.
          </Empty>
        }
      />
    </Panel>
  );
}

/** Delete a claim, when the role may delete claims in its namespace. */
function ClaimDelete({ claim }: { claim: Claim }) {
  const kube = useKube();
  const ok = useCan({ verb: 'delete', group: 'objectbucket.io', resource: 'objectbucketclaims', namespace: claim.namespace });
  return (
    <IconAction
      icon="mdi:delete-outline"
      label={ok ? `Delete ${claim.name}` : `Your role does not allow deleting bucket claims in ${claim.namespace}`}
      disabled={!ok || !!claim.obc.metadata.deletionTimestamp}
      onClick={() => deleteClaim(claim.obc, kube.storageClasses.items.find(s => s.metadata.name === claim.storageClass))}
    />
  );
}
