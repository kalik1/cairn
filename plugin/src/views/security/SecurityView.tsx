/*
 * Security (cephx): the CVE-2025-30156 migration ladder on the basalt
 * band, what the CVE is, the ciphers and insecure-key warnings (with the
 * documented mute stopgap), every Ceph entity with its key type and caps
 * (never a key), and the CephClient users.
 */

import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import React from 'react';
import { out, outError, useCeph, useCephQuery } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { rookAttrs, useCan } from '../../api/permissions';
import {
  AUTH_CONFIG_DOC,
  authQueries,
  CEPH_CVE_DOC,
  deleteClient,
  GHSA_DOC,
  HEALTH_DOC,
  muteViaRook,
  ROOK_CEPHX_DOC,
  rotateClient,
  SECURITY_KEY,
} from '../../api/securityOps';
import {
  cephClientUser,
  cephHasAes256k,
  CephxEntity,
  cephxLadder,
  clientKeyType,
  csiReadiness,
  EntityKind,
  keySummary,
  KeyType,
  KIND_WORD,
  mergeEntities,
  parseAuthList,
  parseDumpKeys,
  rookMutePolicy,
} from '../../model/cephx';
import { Obj } from '../../model/types';
import { NoLive } from '../../shell/Gate';
import { hrefFor } from '../../shell/nav';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Band, Empty, Grid, IconAction, KV, Mono, Notice, Page, Panel, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { DocLink, PhaseLabel } from '../cephfs/formkit';
import { Go } from '../cephfs/fsParts';
import { openCreateClient } from './clientDialog';
import { LadderBand } from './Ladder';

const keyTone = (k: KeyType) => (k === 'aes256k' ? 'ok' : k === 'aes' ? 'warn' : 'idle');
const MUTABLE = ['AUTH_INSECURE_KEYS_ALLOWED', 'AUTH_INSECURE_KEYS_CREATABLE'];

export function SecurityView() {
  const kube = useKube();
  const ceph = useCeph();
  const ready = ceph.phase === 'ready';
  const q = useCephQuery(`${SECURITY_KEY}:auth`, ready ? authQueries : null, { intervalMs: 30000 });
  const clients = kube.clients.items.filter(c => c.metadata.namespace === kube.ns);
  const clientUsers = React.useMemo(() => new Set(clients.map(cephClientUser)), [clients]);
  const entities = React.useMemo(() => {
    const ls = out(q.data, 0);
    if (!ls) return null;
    const dk = out(q.data, 1);
    return mergeEntities(parseAuthList(ls, clientUsers), dk ? parseDumpKeys(dk) : null, clientUsers);
  }, [q.data, clientUsers]);
  const rotating = React.useMemo(() => {
    const dk = out(q.data, 1);
    return dk ? parseDumpKeys(dk).rotating : undefined;
  }, [q.data]);
  const checks = (ceph.core.health?.checks ?? []).map(c => c.code);
  const steps = cephxLadder({
    entities,
    rotating,
    quorum: ceph.core.quorum,
    cluster: kube.cephCluster,
    clients,
    checks,
    nfsCount: kube.nfs.items.length,
  });
  const summary = entities ? keySummary(entities) : null;
  const readiness = csiReadiness(kube.nodes.items, kube.rookPods.items);
  const version = String(kube.cephCluster?.status?.version?.version ?? '').replace(/-\d+$/, '');
  const authError = outError(q.data, 0) ?? q.error;

  return (
    <Page
      title="Security"
      subtitle="Cephx: the key type of every Ceph entity, the ciphers the monitors accept, and the steps that close CVE-2025-30156."
    >
      {!ready && ceph.phase !== 'checking' && <NoLive what="auth ls, auth dump-keys" />}
      <Band>
        <LadderBand steps={steps} summary={summary} readiness={readiness} versionOk={version ? cephHasAes256k(version) : null} version={version} />
        {authError && <Box sx={{ mt: 1.5, fontSize: 13, color: '#93A4AE' }}>Ceph did not list the keys: {authError}</Box>}
      </Band>
      <Grid min={560}>
        <CvePanel />
        <CiphersPanel />
      </Grid>
      <EntitiesPanel entities={entities} loading={q.loading} />
      <ClientsPanel clients={clients} entities={entities} />
    </Page>
  );
}

function CvePanel() {
  const t = useTokens();
  return (
    <Panel title="What CVE-2025-30156 is" icon="mdi:shield-alert-outline">
      <Box sx={{ fontSize: 13.5, lineHeight: 1.6, display: 'grid', gap: 1, '& p': { m: 0 } }}>
        <p>
          Cephx is how Ceph daemons and clients prove who they are. Its original key type, <Mono>aes</Mono> (AES-128-CBC), has no integrity check and a fixed
          IV: the same message always encrypts the same way, and flipped bits go unnoticed.
        </p>
        <p>
          Anyone holding one low-privilege key, or able to watch cephx traffic, can tamper with the service tickets the monitors hand out, for example turn a
          ticket into one with admin rights on the OSDs, MDS or mgr. A published proof of concept reached full cluster admin. Severity: CVSS 8.9 (high).
        </p>
        <p>
          Ceph 20.2.4 and 19.2.6 add <Mono>aes256k</Mono> (AES-256 with an HMAC-SHA384 check, RFC 8009), which detects tampering. Upgrading is not enough: the
          keys have to move to aes256k, then the monitors must stop accepting aes. Rook does both from the CephCluster and CephClient specs.
        </p>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', color: t.muted, fontSize: 13 }}>
          <DocLink href={CEPH_CVE_DOC}>Ceph advisory</DocLink>
          <DocLink href={GHSA_DOC}>GHSA-7q3q-3975-qw3q</DocLink>
          <DocLink href={ROOK_CEPHX_DOC}>Rook: CephX keys and rotation</DocLink>
          <DocLink href={AUTH_CONFIG_DOC}>Ceph auth settings</DocLink>
        </Box>
      </Box>
    </Panel>
  );
}

function CiphersPanel() {
  const ceph = useCeph();
  const kube = useKube();
  const t = useTokens();
  const q = ceph.core.quorum;
  const cluster = kube.cephCluster;
  const canEdit = useCan(rookAttrs('update', 'cephclusters', kube.ns));
  const auth = (ceph.core.health?.checks ?? []).filter(c => c.code.startsWith('AUTH_INSECURE'));
  const mutable = auth.filter(c => MUTABLE.includes(c.code)).map(c => c.code);
  const rookMuted = MUTABLE.filter(c => rookMutePolicy(cluster, c) === 'mute');
  const specAllowed: string[] = cluster?.spec?.security?.cephx?.allowedCiphers ?? [];
  return (
    <Panel title="Ciphers and warnings" icon="mdi:key-chain-variant">
      <Box sx={{ display: 'grid', gap: 2 }}>
        <KV
          labelWidth={170}
          rows={[
            [
              'Monitors accept',
              q ? (
                <Box key="a" sx={{ display: 'inline-flex', gap: 1.5, flexWrap: 'wrap' }}>
                  {q.allowedCiphers.map(c => (
                    <StateLabel key={c} tone={c === 'aes256k' ? 'ok' : 'warn'}>
                      {c}
                    </StateLabel>
                  ))}
                </Box>
              ) : (
                '—'
              ),
            ],
            ['Preferred for new keys', q?.preferredCipher || '—'],
            ['Service tickets', q?.serviceCipher ? <StateLabel key="s" tone={q.serviceCipher === 'aes256k' ? 'ok' : 'err'}>{q.serviceCipher}</StateLabel> : '—'],
            ['CephCluster allowedCiphers', specAllowed.length ? <Mono key="c">{specAllowed.join(', ')}</Mono> : 'Not set: Rook keeps aes and aes256k'],
          ]}
        />
        {auth.length ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {auth.map(c => (
              <Box key={c.code} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 1, alignItems: 'start' }}>
                <Box sx={{ minWidth: 0 }}>
                  <StateLabel tone={c.muted ? 'idle' : c.severity === 'HEALTH_ERR' ? 'err' : 'warn'}>
                    <Mono>{c.code}</Mono>
                    {c.muted ? ' (muted)' : ''}
                  </StateLabel>
                  <Box sx={{ fontSize: 12.5, color: t.muted, mt: 0.25 }}>{c.summary}</Box>
                </Box>
                <Box sx={{ fontSize: 12.5, color: t.muted }}>{c.firstSeen ? <When at={c.firstSeen} prefix="since" /> : null}</Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ fontSize: 13.5, color: t.muted }}>{ceph.core.health ? 'No insecure-key warning is active.' : 'Health not read yet.'}</Box>
        )}
        {(mutable.length > 0 || rookMuted.length > 0) && cluster && (
          <Notice tone="idle" title="Stopgap while the migration waits">
            <p>
              When something prevents the migration for now, Rook documents muting {MUTABLE.join(' and ')} (warnings) until it is done. The risk stays. Do not
              mute AUTH_INSECURE_SERVICE_KEY_TYPE or AUTH_INSECURE_SERVICE_TICKETS: they are errors, fixed by step 1.
            </p>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1, alignItems: 'center' }}>
              <Go to={hrefFor('overview')} sx={{ fontSize: 13.5 }}>
                Mute in Ceph for a while (Overview)
              </Go>
              {mutable.length > 0 && (
                <Action icon="mdi:bell-off-outline" onClick={() => muteViaRook(cluster, MUTABLE, 'mute')} reason={canEdit ? null : 'Your role does not allow editing the CephCluster'}>
                  Mute through Rook
                </Action>
              )}
              {rookMuted.length > 0 && (
                <Action icon="mdi:bell-outline" onClick={() => muteViaRook(cluster, rookMuted, 'unmute')} reason={canEdit ? null : 'Your role does not allow editing the CephCluster'}>
                  Unmute through Rook
                </Action>
              )}
            </Box>
          </Notice>
        )}
        <Box sx={{ fontSize: 12.5, color: t.muted }}>
          <DocLink href={HEALTH_DOC}>The AUTH_INSECURE health checks</DocLink>
        </Box>
      </Box>
    </Panel>
  );
}

const capText = (caps: Record<string, string>) =>
  Object.entries(caps)
    .map(([k, v]) => `${k} "${v}"`)
    .join(', ');

function EntitiesPanel({ entities, loading }: { entities: CephxEntity[] | null; loading: boolean }) {
  const t = useTokens();
  const [text, setText] = React.useState('');
  const [kind, setKind] = React.useState<EntityKind | ''>('');
  const [key, setKey] = React.useState<KeyType | ''>('');
  const rows = (entities ?? []).filter(
    e =>
      (!kind || e.kind === kind) &&
      (!key || e.keyType === key) &&
      (!text || e.entity.toLowerCase().includes(text.toLowerCase()) || capText(e.caps).toLowerCase().includes(text.toLowerCase()))
  );
  const cols: Column<CephxEntity>[] = [
    { id: 'entity', header: 'Entity', cell: e => <Mono>{e.entity}</Mono>, sort: e => e.entity, width: 260 },
    { id: 'kind', header: 'Owner', cell: e => KIND_WORD[e.kind], sort: e => e.kind },
    {
      id: 'key',
      header: 'Key type',
      cell: e => (
        <StateLabel tone={keyTone(e.keyType)} title={e.pendingKeyType ? `A ${e.pendingKeyType} key is pending` : undefined}>
          {e.keyType}
          {e.pendingKeyType ? `, ${e.pendingKeyType} pending` : ''}
        </StateLabel>
      ),
      sort: e => e.keyType,
    },
    { id: 'created', header: 'Key created', cell: e => <When at={e.created ?? null} />, sort: e => e.created ?? 0, minWidth: 900 },
    {
      id: 'caps',
      header: 'Caps',
      cell: e => (
        <Box component="span" title={capText(e.caps)} sx={{ fontFamily: t.font.mono, fontSize: 12.5, color: t.muted }}>
          {capText(e.caps) || '—'}
        </Box>
      ),
      width: 520,
    },
  ];
  const s = entities ? keySummary(entities) : null;
  return (
    <Panel
      title="Entities"
      icon="mdi:account-lock-outline"
      dense
      actions={s ? <Box sx={{ fontSize: 13, color: t.muted }}>{`${s.total} keys: ${s.aes256k} aes256k, ${s.aes} aes`}</Box> : undefined}
    >
      <Box sx={{ display: 'flex', gap: 1.5, px: 2, py: 1.25, flexWrap: 'wrap', borderBottom: `1px solid ${t.rule}` }}>
        <TextField size="small" label="Filter" value={text} onChange={e => setText(e.target.value)} placeholder="Entity or cap" sx={{ minWidth: 240 }} inputProps={{ name: 'entity-filter' }} />
        <TextField select size="small" label="Owner" value={kind} onChange={e => setKind(e.target.value as EntityKind | '')} sx={{ minWidth: 180 }} InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
          <MenuItem value="">All</MenuItem>
          {(Object.keys(KIND_WORD) as EntityKind[]).map(k => (
            <MenuItem key={k} value={k}>
              {KIND_WORD[k]}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Key type" value={key} onChange={e => setKey(e.target.value as KeyType | '')} sx={{ minWidth: 150 }} InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="aes256k">aes256k</MenuItem>
          <MenuItem value="aes">aes</MenuItem>
        </TextField>
        <Box sx={{ alignSelf: 'center', fontSize: 12.5, color: t.muted, flex: 1, minWidth: 200 }}>
          Keys never leave the cluster: Cairn reads their type from auth dump-keys, not the keys.
        </Box>
      </Box>
      {entities === null && !loading ? (
        <Box sx={{ p: 2 }}>
          <NoLive compact what="auth ls" />
        </Box>
      ) : (
        <DataTable
          label="Ceph entities"
          rows={rows}
          columns={cols}
          rowKey={e => e.entity}
          initialSort={{ id: 'entity', dir: 'asc' }}
          empty={
            <Empty icon="mdi:account-lock-outline" title={loading && !entities ? 'Reading the keys…' : 'No entity matches'}>
              {entities ? 'Change the filter to see more.' : null}
            </Empty>
          }
        />
      )}
    </Panel>
  );
}

function ClientsPanel({ clients, entities }: { clients: Obj[]; entities: CephxEntity[] | null }) {
  const kube = useKube();
  const t = useTokens();
  const canCreate = useCan(rookAttrs('create', 'cephclients', kube.ns));
  const canUpdate = useCan(rookAttrs('update', 'cephclients', kube.ns));
  const canDelete = useCan(rookAttrs('delete', 'cephclients', kube.ns));
  const cols: Column<Obj>[] = [
    { id: 'name', header: 'CephClient', cell: c => <Mono>{c.metadata.name}</Mono>, sort: c => c.metadata.name },
    { id: 'user', header: 'Ceph user', cell: c => <Mono>{`client.${cephClientUser(c)}`}</Mono>, minWidth: 900 },
    { id: 'phase', header: 'State', cell: c => <PhaseLabel phase={c.status?.phase} />, sort: c => c.status?.phase ?? '' },
    {
      id: 'key',
      header: 'Key type',
      cell: c => {
        const k = clientKeyType(c, entities);
        return <StateLabel tone={keyTone(k)}>{k === 'unknown' ? 'Unknown' : k}</StateLabel>;
      },
      sort: c => clientKeyType(c, entities),
    },
    { id: 'gen', header: 'Key generation', align: 'right', cell: c => c.status?.cephx?.keyGeneration ?? '—', minWidth: 1000 },
    {
      id: 'caps',
      header: 'Caps',
      cell: c => (
        <Box component="span" title={capText(c.spec?.caps ?? {})} sx={{ fontFamily: t.font.mono, fontSize: 12.5, color: t.muted }}>
          {capText(c.spec?.caps ?? {}) || '—'}
        </Box>
      ),
      width: 420,
    },
    {
      id: 'act',
      header: '',
      align: 'right',
      width: 90,
      cell: c => (
        <Box sx={{ display: 'inline-flex' }}>
          {clientKeyType(c, entities) === 'aes' && (
            <IconAction icon="mdi:key-change" label={canUpdate ? 'Move the key to aes256k' : 'Your role does not allow editing CephClients'} disabled={!canUpdate} onClick={() => rotateClient(c)} />
          )}
          <IconAction
            icon="mdi:delete-outline"
            label={canDelete ? `Delete ${c.metadata.name}` : 'Your role does not allow deleting CephClients'}
            disabled={!canDelete || !!c.metadata.deletionTimestamp}
            onClick={() => deleteClient(c)}
          />
        </Box>
      ),
    },
  ];
  return (
    <Box id="cairn-cephclients" sx={{ scrollMarginTop: 16 }}>
      <Panel
        title="CephClient users"
        icon="mdi:account-key-outline"
        dense
        actions={
          <Action icon="mdi:plus" onClick={openCreateClient} reason={canCreate ? null : 'Your role does not allow creating CephClients'}>
            Create CephClient
          </Action>
        }
      >
        <DataTable
          label="CephClient users"
          rows={clients}
          columns={cols}
          rowKey={c => c.metadata.name}
          empty={
            <Empty icon="mdi:account-key-outline" title="No CephClient">
              A CephClient is a Ceph user Rook manages for something outside the cluster, with the caps you give it and its keyring in a Secret.
            </Empty>
          }
        />
      </Panel>
    </Box>
  );
}
