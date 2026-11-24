/*
 * The Rook operator and what it says about the CephCluster: deployment,
 * pod and version; phase, message, conditions, generation; the Kubernetes
 * events of the Rook namespace, warnings first. On k4all the Ceph image is
 * k4all's (it moves with the Rook release k4all pins), shown read-only.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useK4all } from '../../api/k4all';
import { useKube } from '../../api/kube';
import { ClusterCondition, clusterState, crashCollectorDisabled } from '../../model/clusterSpec';
import { k4allOwns } from '../../model/ownership';
import { Obj } from '../../model/types';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Empty, KV, Mono, Notice, Panel, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { Hint, NodeLink, PodLink, ViewLink } from '../overview/common';
import { K4allManaged } from './counts';
import { podImage, podState, restarts } from './pods';
import { useOperator } from './useOperator';

const evTime = (e: Obj) => e.lastTimestamp ?? e.eventTime ?? e.series?.lastObservedTime ?? e.metadata.creationTimestamp ?? '';

export function Operator() {
  const kube = useKube();
  const op = useOperator();
  const cc = kube.cephCluster;
  const s = clusterState(cc);
  const k4allImage = k4allOwns(cc, 'spec.cephVersion.image', useK4all());
  const d = op.deployment;
  const pod = op.pods.find(p => podState(p).tone === 'ok') ?? op.pods[0];
  const img = pod ? podImage(pod) : d ? { image: d.spec?.template?.spec?.containers?.[0]?.image ?? '', tag: '' } : null;
  const ready = Number(d?.status?.readyReplicas ?? 0);
  const want = Number(d?.spec?.replicas ?? 1);
  const [allEvents, setAllEvents] = React.useState(false);
  const sorted = React.useMemo(
    () => [...kube.events.items].sort((a, b) => (a.type === 'Warning' ? 0 : 1) - (b.type === 'Warning' ? 0 : 1) || evTime(b).localeCompare(evTime(a))),
    [kube.events.items]
  );
  const events = allEvents ? sorted : sorted.slice(0, 40);
  const condCols: Column<ClusterCondition>[] = [
    { id: 'type', header: 'Condition', cell: c => c.type, sort: c => c.type },
    { id: 'status', header: 'Status', cell: c => <StateLabel tone={c.status === 'True' ? (c.type === 'Ready' ? 'ok' : 'idle') : 'warn'}>{c.status}</StateLabel>, sort: c => c.status },
    { id: 'reason', header: 'Reason', cell: c => c.reason ?? '—', sort: c => c.reason ?? '' },
    { id: 'msg', header: 'Message', cell: c => <Box component="span" sx={{ whiteSpace: 'normal' }}>{c.message ?? '—'}</Box>, width: 420 },
    { id: 'when', header: 'Since', cell: c => <When at={c.lastTransitionTime} />, sort: c => c.lastTransitionTime ?? '' },
  ];
  const evCols: Column<Obj>[] = [
    { id: 'type', header: 'Type', cell: e => <StateLabel tone={e.type === 'Warning' ? 'warn' : 'idle'}>{e.type ?? 'Normal'}</StateLabel>, sort: e => (e.type === 'Warning' ? 0 : 1), width: 110 },
    { id: 'reason', header: 'Reason', cell: e => e.reason ?? '—', sort: e => e.reason ?? '' },
    {
      id: 'obj',
      header: 'Object',
      cell: e => (
        <Mono>
          {e.involvedObject?.kind ?? e.regarding?.kind}/{e.involvedObject?.name ?? e.regarding?.name}
        </Mono>
      ),
      sort: e => `${e.involvedObject?.kind}/${e.involvedObject?.name}`,
      width: 300,
    },
    { id: 'msg', header: 'Message', cell: e => <Box component="span" sx={{ whiteSpace: 'normal' }}>{e.message ?? e.note ?? ''}</Box>, width: 520 },
    { id: 'count', header: 'Count', cell: e => e.count ?? e.series?.count ?? 1, sort: e => Number(e.count ?? 1), align: 'right', minWidth: 900 },
    { id: 'when', header: 'Last seen', cell: e => <When at={evTime(e)} />, sort: e => evTime(e), minWidth: 760 },
  ];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        <Panel title="Rook operator" icon="mdi:robot-outline">
          {!op.looked ? (
            <Hint>Looking for the operator…</Hint>
          ) : !d && !pod ? (
            <Notice tone="err" title="No Rook operator found">
              No rook-ceph-operator Deployment or pod is visible to your role. Without it, changes to Rook resources are not applied and failed
              daemons are not replaced.
            </Notice>
          ) : (
            <KV
              labelWidth={150}
              rows={[
                [
                  'Deployment',
                  d ? (
                    <StateLabel key="d" tone={ready >= want && want > 0 ? 'ok' : 'err'}>
                      {d.metadata.namespace}/{d.metadata.name}: {ready} of {want} ready
                    </StateLabel>
                  ) : (
                    '—'
                  ),
                ],
                ['Pod', pod ? <PodLink key="p" namespace={pod.metadata.namespace} name={pod.metadata.name} /> : '—'],
                ['Pod state', pod ? `${podState(pod).word}${restarts(pod) ? `, ${restarts(pod)} restarts` : ''}` : '—'],
                ['Node', <NodeLink key="n" name={pod?.spec?.nodeName} />],
                ['Started', pod ? <When key="w" at={pod.status?.startTime ?? pod.metadata.creationTimestamp} /> : '—'],
                ['Image', img ? <Mono key="i">{img.image}</Mono> : '—'],
                ['Rook version', d?.metadata.labels?.['helm.sh/chart'] ?? pod?.metadata.labels?.['helm.sh/chart'] ?? img?.tag ?? '—'],
              ]}
            />
          )}
        </Panel>
        <Panel title={`CephCluster ${cc ? `${cc.metadata.namespace}/${cc.metadata.name}` : ''}`} icon="mdi:server-network">
          {!cc ? (
            <Hint>No CephCluster.</Hint>
          ) : (
            <>
              {s.pending && (
                <Notice tone="move" sx={{ mb: 1.5 }} title="Rook is behind the latest change">
                  The CephCluster is at generation {s.generation}; Rook last finished generation {s.observedGeneration}.
                </Notice>
              )}
              <KV
                labelWidth={170}
                rows={[
                  ['Phase', <StateLabel key="p" tone={s.ready ? 'ok' : s.phase === 'Progressing' ? 'move' : 'warn'}>{s.phase || 'Unknown'}{s.state ? ` (${s.state})` : ''}</StateLabel>],
                  ['Message', s.message || '—'],
                  ['Generation', `${s.generation}, observed ${s.observedGeneration || '—'}`],
                  ['Ceph version', s.cephVersion || '—'],
                  [
                    'Ceph image',
                    <Box key="i">
                      <Mono>{s.specImage || s.image || '—'}</Mono>
                      {k4allImage && <K4allManaged fields={['spec.cephVersion.image']} sx={{ mt: 1 }} />}
                    </Box>,
                  ],
                  [
                    'Monitors wanted',
                    <span key="mon">
                      {String(cc.spec?.mon?.count ?? 3) + (cc.spec?.mon?.allowMultiplePerNode ? ', several per node allowed' : ', one per node')}{' '}
                      <ViewLink view="daemons" a="mons">
                        Change
                      </ViewLink>
                    </span>,
                  ],
                  [
                    'Managers wanted',
                    <span key="mgr">
                      {String(cc.spec?.mgr?.count ?? 1)}{' '}
                      <ViewLink view="daemons" a="mgr">
                        Change
                      </ViewLink>
                    </span>,
                  ],
                  ['Crash collector', crashCollectorDisabled(cc) ? 'Off (spec.crashCollector.disable)' : 'On'],
                  ['Data directory', <Mono key="dd">{cc.spec?.dataDirHostPath ?? '—'}</Mono>],
                  ['Last health check', <When key="h" at={cc.status?.ceph?.lastChecked} />],
                ]}
              />
            </>
          )}
        </Panel>
      </Box>
      {cc && s.conditions.length > 0 && (
        <Panel title="Conditions" icon="mdi:list-status" dense>
          <DataTable label="CephCluster conditions" rows={s.conditions} columns={condCols} rowKey={c => c.type} initialSort={{ id: 'when', dir: 'desc' }} />
        </Panel>
      )}
      <Panel
        title={`Events in ${kube.ns}`}
        icon="mdi:calendar-alert"
        dense
        actions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Hint>Warnings first, then newest</Hint>
            {sorted.length > 40 && (
              <Action onClick={() => setAllEvents(v => !v)}>{allEvents ? 'Show the first 40' : `Show all ${sorted.length}`}</Action>
            )}
          </Box>
        }
      >
        <DataTable
          label="Events"
          rows={events}
          columns={evCols}
          rowKey={e => e.metadata.uid ?? e.metadata.name}
          initialSort={{ id: 'type', dir: 'asc' }}
          empty={<Empty icon="mdi:calendar-check" title="No recent events">{kube.events.forbidden ? `Your role may not list events in ${kube.ns}.` : 'Kubernetes keeps events for about an hour.'}</Empty>}
        />
      </Panel>
    </Box>
  );
}
