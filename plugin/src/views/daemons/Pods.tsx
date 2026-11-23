/*
 * Every pod of the Rook namespace by daemon type (monitors, managers,
 * OSDs, MDS, RGW, exporters, crash collectors, CSI, OSD prepare jobs),
 * with node, state, restarts, age and image; the Ceph versions the
 * daemons report, and a warning when they differ.
 */

import Box from '@mui/material/Box';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { Obj } from '../../model/types';
import { Column, DataTable } from '../../ui/DataTable';
import { Empty, Mono, Notice, Panel, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { Hint, NodeLink, PodLink } from '../overview/common';
import { daemonId, DaemonType, daemonType, mixedVersions, podImage, podState, restarts, TYPE_LABEL, TYPE_ORDER } from './pods';

export function Pods() {
  const kube = useKube();
  const { core } = useCeph();
  const [type, setType] = React.useState<DaemonType | 'all'>('all');
  const pods = kube.rookPods.items;
  const typed = React.useMemo(() => pods.map(p => ({ p, type: daemonType(p) })), [pods]);
  const counts = new Map<DaemonType, { total: number; ok: number }>();
  for (const x of typed) {
    const c = counts.get(x.type) ?? { total: 0, ok: 0 };
    c.total++;
    const s = podState(x.p);
    if (s.tone === 'ok' || s.word === 'Completed') c.ok++;
    counts.set(x.type, c);
  }
  const rows = typed.filter(x => type === 'all' || x.type === type);
  const cols: Column<{ p: Obj; type: DaemonType }>[] = [
    { id: 'pod', header: 'Pod', cell: x => <PodLink namespace={x.p.metadata.namespace} name={x.p.metadata.name} />, sort: x => x.p.metadata.name, width: 380 },
    { id: 'type', header: 'Type', cell: x => TYPE_LABEL[x.type], sort: x => TYPE_ORDER.indexOf(x.type) },
    { id: 'id', header: 'Daemon', cell: x => (daemonId(x.p) ? <Mono>{daemonId(x.p)}</Mono> : '—'), sort: x => daemonId(x.p), minWidth: 900 },
    { id: 'node', header: 'Node', cell: x => <NodeLink name={x.p.spec?.nodeName} />, sort: x => x.p.spec?.nodeName ?? '' },
    {
      id: 'state',
      header: 'State',
      cell: x => {
        const s = podState(x.p);
        return <StateLabel tone={s.tone}>{s.word}</StateLabel>;
      },
      sort: x => podState(x.p).word,
    },
    { id: 'restarts', header: 'Restarts', cell: x => restarts(x.p), sort: x => restarts(x.p), align: 'right' },
    { id: 'age', header: 'Age', cell: x => <When at={x.p.metadata.creationTimestamp} />, sort: x => x.p.metadata.creationTimestamp ?? '', minWidth: 700 },
    {
      id: 'image',
      header: 'Image',
      cell: x => {
        const i = podImage(x.p);
        return (
          <Mono title={i.image} muted>
            {i.tag}
          </Mono>
        );
      },
      sort: x => podImage(x.p).tag,
      minWidth: 800,
    },
  ];
  const versions = core.versions;
  const mixed = mixedVersions(versions);
  const daemons = Object.entries(versions ?? {}).filter(([k]) => k !== 'overall');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Panel
        title={`Pods in ${kube.ns}`}
        icon="mdi:cube-outline"
        dense
        actions={<Hint>{pods.length} pods</Hint>}
      >
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', overflowX: 'auto' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={type}
            onChange={(_, v) => v && setType(v)}
            aria-label="Daemon type"
            sx={{ flexWrap: 'wrap', '& .MuiToggleButton-root': { textTransform: 'none', py: 0.25, px: 1.25, fontSize: 13 } }}
          >
            <ToggleButton value="all">All {pods.length}</ToggleButton>
            {TYPE_ORDER.filter(tp => counts.has(tp)).map(tp => {
              const c = counts.get(tp)!;
              return (
                <ToggleButton key={tp} value={tp} title={`${c.ok} of ${c.total} running or completed`}>
                  {TYPE_LABEL[tp]} {c.ok === c.total ? c.total : `${c.ok}/${c.total}`}
                </ToggleButton>
              );
            })}
          </ToggleButtonGroup>
        </Box>
        <DataTable
          label="Rook pods"
          rows={rows}
          columns={cols}
          rowKey={x => x.p.metadata.uid ?? x.p.metadata.name}
          initialSort={{ id: 'type', dir: 'asc' }}
          empty={<Empty icon="mdi:cube-off-outline" title="No pods">{kube.rookPods.forbidden ? `Your role may not list pods in ${kube.ns}.` : 'No pod of this type.'}</Empty>}
        />
      </Panel>
      <Panel title="Ceph versions" icon="mdi:tag-outline">
        {mixed.length > 0 && (
          <Notice tone="warn" sx={{ mb: 1.5 }} title="Daemons run different versions">
            {mixed.join(' and ')}. Expected during an upgrade; otherwise check the CephCluster image and the Rook operator.
          </Notice>
        )}
        {!versions ? (
          <Hint>Reading the versions…</Hint>
        ) : (
          <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 13.5, '& td, & th': { py: 0.6, pr: 3, textAlign: 'left', borderBottom: 1, borderColor: 'divider' }, '& th': { fontWeight: 600, color: 'text.secondary', fontSize: 12.5 } }}>
            <thead>
              <tr>
                <th>Daemon</th>
                <th>Version</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {daemons.flatMap(([d, vs]) =>
                Object.entries(vs).map(([v, n]) => (
                  <tr key={`${d}-${v}`}>
                    <td>
                      <Mono>{d}</Mono>
                    </td>
                    <td>{v}</td>
                    <td>{n}</td>
                  </tr>
                ))
              )}
            </tbody>
          </Box>
        )}
      </Panel>
    </Box>
  );
}
