/*
 * Monitors: the quorum, each monitor's rank, role, address, pod, node and
 * version, the cephx ciphers the monmap allows, and when a restart is safe.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { mon } from '../../api/bridge';
import { out, useCeph, useCephQuery } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { duration } from '../../model/format';
import { MonInfo } from '../../model/types';
import { Column, DataTable } from '../../ui/DataTable';
import { KV, Mono, Notice, Panel, Tag } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { CommandList, Hint, NodeLink, PodLink, ViewLink } from '../overview/common';
import { monRestartSafety, podState, restarts } from './pods';

interface MonMeta {
  name: string;
  hostname?: string;
  pod_name?: string;
  pod_namespace?: string;
  ceph_version_short?: string;
  created_at?: string;
}

export function Mons() {
  const c = useCeph();
  const kube = useKube();
  const q = c.core.quorum;
  const metaQ = useCephQuery('daemons.monmeta', [mon('mon metadata')], { staleMs: 60000 });
  const meta = new Map((out<MonMeta[]>(metaQ.data) ?? []).map(m => [m.name, m]));
  const pods = kube.rookPods.items.filter(p => p.metadata.labels?.app === 'rook-ceph-mon');
  const podOf = (name: string) => pods.find(p => p.metadata.labels?.mon === name || p.metadata.labels?.ceph_daemon_id === name);
  const mons = q?.mons ?? [];
  const safety = monRestartSafety(mons.length, q?.quorum.length ?? 0);
  const cols: Column<MonInfo>[] = [
    { id: 'name', header: 'Monitor', cell: m => <Mono>mon.{m.name}</Mono>, sort: m => m.name },
    { id: 'rank', header: 'Rank', cell: m => m.rank, sort: m => m.rank, align: 'right' },
    { id: 'role', header: 'Role', cell: m => (m.leader ? 'Leader' : m.inQuorum ? 'Peon' : '—'), sort: m => (m.leader ? 0 : 1) },
    {
      id: 'quorum',
      header: 'Quorum',
      cell: m => <StateLabel tone={m.inQuorum ? 'ok' : 'err'}>{m.inQuorum ? 'In quorum' : 'Out of quorum'}</StateLabel>,
      sort: m => (m.inQuorum ? 1 : 0),
    },
    { id: 'addr', header: 'Address', cell: m => <Mono>{m.addr}</Mono>, sort: m => m.addr, minWidth: 700 },
    {
      id: 'pod',
      header: 'Pod',
      cell: m => {
        const p = podOf(m.name);
        const md = meta.get(m.name);
        return <PodLink namespace={p?.metadata.namespace ?? md?.pod_namespace} name={p?.metadata.name ?? md?.pod_name} />;
      },
      minWidth: 900,
    },
    {
      id: 'podstate',
      header: 'Pod state',
      cell: m => {
        const p = podOf(m.name);
        if (!p) return '—';
        const s = podState(p);
        const r = restarts(p);
        return (
          <StateLabel tone={s.tone}>
            {s.word}
            {r ? `, ${r} restarts` : ''}
          </StateLabel>
        );
      },
      minWidth: 800,
    },
    { id: 'node', header: 'Node', cell: m => <NodeLink name={podOf(m.name)?.spec?.nodeName ?? meta.get(m.name)?.hostname} />, minWidth: 640 },
    { id: 'version', header: 'Version', cell: m => meta.get(m.name)?.ceph_version_short ?? '—', minWidth: 1000 },
  ];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Panel title="Monitors" icon="mdi:eye-outline" dense actions={<Hint>{q ? `Quorum formed ${duration(q.ageSec)} ago` : ''}</Hint>}>
        <DataTable label="Monitors" rows={mons} columns={cols} rowKey={m => m.name} initialSort={{ id: 'rank', dir: 'asc' }} />
      </Panel>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        <Panel title="Monitor map" icon="mdi:map-outline">
          <KV
            labelWidth={190}
            rows={[
              ['Leader', q?.leader ? <Mono key="l">mon.{q.leader}</Mono> : '—'],
              ['In quorum', q ? `${q.quorum.length} of ${q.mons.length}: ${q.quorum.map(n => `mon.${n}`).join(', ')}` : '—'],
              ['Quorum age', q ? duration(q.ageSec) : '—'],
              ['Minimum monitor release', q?.minMonRelease || '—'],
              [
                'Allowed auth ciphers',
                q?.allowedCiphers.length ? (
                  <Box key="c" component="span" sx={{ display: 'inline-flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {q.allowedCiphers.map(x => (
                      <Tag key={x} tone={x === 'aes' ? 'warn' : undefined} title={x === 'aes' ? 'Legacy cipher (CVE-2025-30156)' : undefined}>
                        {x}
                      </Tag>
                    ))}
                  </Box>
                ) : (
                  '—'
                ),
              ],
              ['Preferred cipher', q?.preferredCipher ? <Mono key="p">{q.preferredCipher}</Mono> : '—'],
              ['Service ticket cipher', q?.serviceCipher ? <Mono key="s">{q.serviceCipher}</Mono> : '—'],
            ]}
          />
          <Box sx={{ mt: 1.25, fontSize: 13.5 }}>
            <ViewLink view="security">Open Security for the cephx key migration</ViewLink>
          </Box>
        </Panel>
        <Panel title="Restarting a monitor" icon="mdi:restart">
          <Notice tone={safety.safe ? 'ok' : 'err'} title={safety.safe ? 'One at a time is safe now' : 'Do not restart a monitor now'}>
            {safety.text}
          </Notice>
          <Box sx={{ fontSize: 13.5, lineHeight: 1.6, mt: 1.5, '& p': { m: 0, mb: 1 } }}>
            <p>
              Rook runs each monitor as a Deployment (rook-ceph-mon-&lt;id&gt;) pinned to its node, with its database under the Rook data
              directory on that node. Deleting the pod restarts it on the same node with the same data; Kubernetes does it, Rook does not need
              to.
            </p>
            <p>
              A monitor that stays out of quorum longer than the failover timeout (healthCheck.daemonHealth.mon.timeout, 10 minutes by default) is
              replaced by Rook with a new monitor on another node; the old one is removed.
            </p>
            <CommandList cmds={[`kubectl -n ${kube.ns} delete pod -l app=rook-ceph-mon,mon=<id>`]} />
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}
