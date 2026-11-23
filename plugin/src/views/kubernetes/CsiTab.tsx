/*
 * Ceph-CSI as Kubernetes runs it: where Ceph volumes can be mounted (the
 * node plugin of each node), every driver with its ceph-csi Driver spec, its
 * controller plugin and node plugin and their images, the pods per node with
 * readiness and restarts, and the ceph-csi operator with its
 * CephConnections and ClientProfiles.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { itemsOf, useKGets } from '../../api/k8sOps';
import { useKube } from '../../api/kube';
import { CsiDriverInfo, csiDrivers, csiOperator, DRIVER_WORDS, driverWorkloads, imagesOf, NodeCoverage, nodeCoverage, podHealth, rollout } from '../../model/csi';
import { duration, plural } from '../../model/format';
import { Obj } from '../../model/types';
import { Loading } from '../../shell/Gate';
import { Column, DataTable } from '../../ui/DataTable';
import { Band, Empty, KV, Mono, Notice, Panel, Tag } from '../../ui/kit';
import { Mark, StateLabel } from '../../ui/Mark';
import { tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { Pre, yesNo } from './parts';

const age = (ts?: string) => (ts ? duration((Date.now() - Date.parse(ts)) / 1000) : '—');

export function CsiTab() {
  const kube = useKube();
  const ns = kube.ns;
  const base = '/apis/csi.ceph.io/v1';
  const paths = [
    '/apis/storage.k8s.io/v1/csidrivers',
    '/apis/storage.k8s.io/v1/csinodes',
    `${base}/cephconnections`,
    `${base}/clientprofiles`,
    `${base}/operatorconfigs`,
  ];
  // Driver CRs (and so their plugins) may live in the operator's namespace, not the cluster's.
  const extraNs = [...new Set(kube.csiDrivers.items.map(d => d.metadata.namespace).filter((n): n is string => !!n && n !== ns))];
  for (const n of extraNs) paths.push(`/apis/apps/v1/namespaces/${n}/deployments`, `/apis/apps/v1/namespaces/${n}/daemonsets`, `/api/v1/namespaces/${n}/pods`);
  const got = useKGets(paths, 30000);
  const g = (p: string) => got[p] ?? { data: null, error: null, loaded: false, missing: false, forbidden: false };
  const csiObjs = itemsOf(g(paths[0]));
  const csiNodesState = g(paths[1]);
  const csiNodes = csiNodesState.loaded && !csiNodesState.error ? itemsOf(csiNodesState) : undefined;
  const deployments = [...kube.deployments.items, ...extraNs.flatMap(n => itemsOf(g(`/apis/apps/v1/namespaces/${n}/deployments`)))];
  const daemonSets = [...kube.daemonSets.items, ...extraNs.flatMap(n => itemsOf(g(`/apis/apps/v1/namespaces/${n}/daemonsets`)))];
  const pods = [...kube.rookPods.items, ...extraNs.flatMap(n => itemsOf(g(`/api/v1/namespaces/${n}/pods`)))];
  const drivers = React.useMemo(() => csiDrivers(kube.csiDrivers.items, csiObjs, kube.storageClasses.items), [kube.csiDrivers.items, csiObjs, kube.storageClasses.items]);

  if (!kube.csiDrivers.loaded || !kube.daemonSets.loaded) return <Loading label="Reading the CSI drivers…" />;
  const work = drivers.map(d => ({ d, w: driverWorkloads(d, deployments, daemonSets, pods) }));
  const cover = work.map(({ d, w }) => ({ d, cov: nodeCoverage(kube.nodes.items, w.node, w.nodePods, d.name, csiNodes) }));
  const op = csiOperator(deployments);

  return (
    <>
      <CoverageBand cover={cover} nodesForbidden={kube.nodes.forbidden} />
      {drivers.length === 0 && (
        <Panel>
          <Empty icon="mdi:connection" title="No Ceph CSI driver found">
            Kubernetes mounts Ceph volumes through ceph-csi. With Rook 1.17 and later the ceph-csi operator deploys it from Driver resources (csi.ceph.io);
            enable the RBD or CephFS driver in the Rook operator settings.
          </Empty>
        </Panel>
      )}
      {work.map(({ d, w }, i) => (
        <DriverPanel key={d.name} d={d} w={w} cov={cover[i].cov} csiNodesKnown={!!csiNodes} />
      ))}
      <OperatorPanel op={op} pods={pods} cephConnections={itemsOf(g(paths[2]))} clientProfiles={itemsOf(g(paths[3]))} operatorConfigs={itemsOf(g(paths[4]))} crdMissing={g(paths[2]).missing} />
    </>
  );
}

function CoverageBand({ cover, nodesForbidden }: { cover: { d: CsiDriverInfo; cov: NodeCoverage[] }[]; nodesForbidden: boolean }) {
  const t = useTokens();
  const first = cover[0];
  const ok = first ? first.cov.filter(c => c.tone === 'ok').length : 0;
  const all = first?.cov.length ?? 0;
  const headline = !first
    ? 'No Ceph CSI driver: Kubernetes cannot mount Ceph volumes'
    : ok === all
    ? `All ${plural(all, 'node')} can mount Ceph ${first.d.kind === 'cephfs' ? 'filesystems' : 'volumes'}`
    : `${ok} of ${plural(all, 'node')} can mount Ceph ${first.d.kind === 'cephfs' ? 'filesystems' : 'volumes'}`;
  return (
    <Band>
      <Typography component="p" sx={{ fontSize: 20, fontWeight: 600, color: t.basaltText, mb: cover.length ? 2 : 0 }}>
        {headline}
      </Typography>
      {nodesForbidden && <Typography sx={{ color: t.basaltMuted, fontSize: 13.5 }}>Your role may not list nodes: only nodes with a node plugin pod are shown.</Typography>}
      {cover.map(({ d, cov }) => (
        <Box key={d.name} sx={{ mb: 1.5, '&:last-child': { mb: 0 } }}>
          <Typography sx={{ fontSize: 13, color: t.basaltMuted, mb: 0.75 }}>
            {DRIVER_WORDS[d.kind]} <Box component="span" sx={{ fontFamily: t.font.mono, fontSize: 12.5 }}>{d.name}</Box>
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {cov.map(c => (
              <Box
                key={c.node}
                title={c.why ?? (c.health ? `${c.pod?.metadata.name}: ${c.health.readyContainers}/${c.health.containers} ready, ${c.health.restarts} restarts` : '')}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.25,
                  py: 0.75,
                  borderRadius: '4px',
                  border: `1px solid ${t.basaltEdge}`,
                  background: 'rgba(255,255,255,0.04)',
                  minWidth: 0,
                  maxWidth: 360,
                }}
              >
                <Mark tone={c.tone} size={10} />
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ fontSize: 13, color: t.basaltText, fontFamily: t.font.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.node}</Box>
                  <Box sx={{ fontSize: 12, color: t.basaltMuted, ...tabular }}>
                    {c.word}
                    {c.health && c.health.restarts > 0 ? `, ${plural(c.health.restarts, 'restart')}` : ''}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Band>
  );
}

function RolloutLine({ w, what }: { w: Obj | undefined; what: string }) {
  const r = rollout(w);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <StateLabel tone={r.tone}>{r.word}</StateLabel>
      {w ? (
        <Box component="span" sx={{ fontSize: 13, color: 'text.secondary', ...tabular }}>
          {r.ready} of {r.want} ready{r.updated < r.want ? `, ${r.updated} updated` : ''}, <Mono>{w.metadata.name}</Mono>
        </Box>
      ) : (
        <Box component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>
          No {what} found
        </Box>
      )}
    </Box>
  );
}

function Images({ w }: { w: Obj | undefined }) {
  const imgs = imagesOf(w);
  if (!imgs.length) return null;
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', fontSize: 12.5, mt: 0.75 }}>
      {imgs.map(i => (
        <Box component="li" key={i.container} sx={{ display: 'flex', gap: 1, py: 0.25, minWidth: 0 }}>
          <Box component="span" sx={{ minWidth: 130, color: 'text.secondary' }}>
            {i.container}
          </Box>
          <Box component="span" sx={{ flex: 'none', whiteSpace: 'nowrap' }}>
            <Mono title={i.image}>{i.version}</Mono>
          </Box>
          <Box component="span" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.image}>
            {i.image.replace(/[:@].*$/, '')}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function DriverPanel({ d, w, cov, csiNodesKnown }: { d: CsiDriverInfo; w: ReturnType<typeof driverWorkloads>; cov: NodeCoverage[]; csiNodesKnown: boolean }) {
  const t = useTokens();
  const spec = d.cr?.spec ?? {};
  const status = d.cr?.status;
  const k = d.csiDriver?.spec ?? {};
  const cols: Column<NodeCoverage>[] = [
    { id: 'node', header: 'Node', cell: c => <Mono>{c.node}</Mono>, sort: c => c.node },
    { id: 'state', header: 'Mount', cell: c => <StateLabel tone={c.tone}>{c.word}</StateLabel>, sort: c => c.tone },
    { id: 'pod', header: 'Node plugin pod', cell: c => (c.pod ? <Mono muted>{c.pod.metadata.name}</Mono> : '—'), sort: c => c.pod?.metadata.name ?? '' },
    { id: 'ready', header: 'Ready', cell: c => (c.health ? `${c.health.readyContainers}/${c.health.containers}` : '—'), align: 'right' },
    { id: 'restarts', header: 'Restarts', cell: c => (c.health ? c.health.restarts : '—'), sort: c => c.health?.restarts ?? -1, align: 'right' },
    { id: 'age', header: 'Age', cell: c => (c.pod ? age(c.pod.metadata.creationTimestamp) : '—'), sort: c => c.pod?.metadata.creationTimestamp ?? '', minWidth: 900 },
    {
      id: 'reg',
      header: 'Kubelet',
      cell: c => (c.registered === undefined ? '—' : c.registered ? 'Registered' : 'Not registered'),
      minWidth: 1000,
    },
    {
      id: 'why',
      header: 'Note',
      cell: c => (
        <Box component="span" sx={{ whiteSpace: 'normal' }}>
          {c.why ?? c.health?.reason ?? ''}
        </Box>
      ),
      width: 360,
    },
  ];
  return (
    <Panel
      title={
        <>
          <Mono>{d.name}</Mono>
          <Box component="span" sx={{ color: t.muted, fontWeight: 400, ml: 1, fontSize: 13.5 }}>
            {DRIVER_WORDS[d.kind]}
          </Box>
        </>
      }
      icon="mdi:connection"
      actions={
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          {d.cr && <Tag>ceph-csi Driver</Tag>}
          {d.classes.length > 0 && <Tag>{plural(d.classes.length, 'class', 'classes')}</Tag>}
        </Box>
      }
      dense
    >
      <Box sx={{ display: 'grid', gap: 3, p: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' }, borderBottom: `1px solid ${t.rule}` }}>
        <Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1 }}>Driver</Typography>
          {d.cr ? (
            <KV
              labelWidth={150}
              rows={[
                ['Attach required', yesNo(spec.attachRequired ?? k.attachRequired)],
                ['fsGroup policy', spec.fsGroupPolicy ?? k.fsGroupPolicy ?? '—'],
                d.kind === 'cephfs' && ['Client', spec.cephFsClientType ?? 'kernel'],
                ['Controller replicas', spec.controllerPlugin?.replicas ?? '—'],
                ['Log verbosity', spec.log?.verbosity ?? '—'],
                ['Log rotation', spec.log?.rotation ? `${spec.log.rotation.periodicity ?? ''}, ${spec.log.rotation.maxFiles ?? '?'} files of ${spec.log.rotation.maxLogSize ?? '?'}` : '—'],
                ['Snapshot policy', spec.snapshotPolicy ?? '—'],
                ['CSI-Addons', yesNo(spec.deployCsiAddons)],
                ['Fencing', yesNo(spec.enableFencing)],
                !!spec.encryption?.configMapName && ['Encryption (KMS)', <Mono key="kms">{spec.encryption.configMapName}</Mono>],
                ['gRPC timeout', spec.grpcTimeout ? `${spec.grpcTimeout} s` : '—'],
                ['Host network', yesNo(spec.controllerPlugin?.hostNetwork)],
                d.classes.length > 0 && ['Classes', <Mono key="cl">{d.classes.join(', ')}</Mono>],
              ]}
            />
          ) : (
            <KV
              labelWidth={150}
              rows={[
                ['Deployed by', d.csiDriver ? 'Rook (no ceph-csi Driver resource)' : 'Unknown: only StorageClasses name it'],
                ['Attach required', yesNo(k.attachRequired)],
                ['fsGroup policy', k.fsGroupPolicy ?? '—'],
                ['Pod info on mount', yesNo(k.podInfoOnMount)],
                d.classes.length > 0 && ['Classes', <Mono key="cl">{d.classes.join(', ')}</Mono>],
              ]}
            />
          )}
          {status && Object.keys(status).length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.5 }}>Status</Typography>
              <Pre label="Driver status">{JSON.stringify(status, null, 2)}</Pre>
            </Box>
          )}
          {!d.csiDriver && (
            <Notice tone="warn" sx={{ mt: 1.5 }} title="Kubernetes does not know this driver">
              There is no CSIDriver object named {d.name}: the kubelet cannot mount its volumes.
            </Notice>
          )}
        </Box>
        <Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1 }}>Controller plugin</Typography>
          <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.75 }}>Creates, deletes, expands and snapshots volumes in Ceph.</Typography>
          <RolloutLine w={w.ctrl} what="controller Deployment" />
          {w.ctrlPods.map(p => {
            const h = podHealth(p);
            return (
              <Box key={p.metadata.name} sx={{ fontSize: 12.5, mt: 0.5, color: t.muted, ...tabular }}>
                <Mono muted>{p.metadata.name}</Mono> on {p.spec?.nodeName ?? '—'}, {h.readyContainers}/{h.containers} ready, {plural(h.restarts, 'restart')}
              </Box>
            );
          })}
          <Images w={w.ctrl} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1 }}>Node plugin</Typography>
          <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.75 }}>Maps and mounts volumes on each node; without it pods there cannot start.</Typography>
          <RolloutLine w={w.node} what="node plugin DaemonSet" />
          <Images w={w.node} />
        </Box>
      </Box>
      <DataTable
        label={`Node plugin pods of ${d.name}`}
        rows={cov}
        columns={cols.filter(c => c.id !== 'reg' || csiNodesKnown)}
        rowKey={c => c.node}
        empty={<Empty icon="mdi:server-off" title="No nodes">No node is visible to your role.</Empty>}
      />
    </Panel>
  );
}

function OperatorPanel({
  op,
  pods,
  cephConnections,
  clientProfiles,
  operatorConfigs,
  crdMissing,
}: {
  op: Obj | undefined;
  pods: Obj[];
  cephConnections: Obj[];
  clientProfiles: Obj[];
  operatorConfigs: Obj[];
  crdMissing: boolean;
}) {
  const t = useTokens();
  if (!op && crdMissing) return null;
  const opPods = op ? pods.filter(p => Object.entries(op.spec?.selector?.matchLabels ?? {}).every(([k, v]) => p.metadata.labels?.[k] === v)) : [];
  const defaults = operatorConfigs[0]?.spec?.driverSpecDefaults;
  return (
    <Panel title="ceph-csi operator" icon="mdi:cog-transfer-outline">
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' } }}>
        <Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1 }}>Controller manager</Typography>
          <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.75 }}>Deploys the drivers above from their Driver resources.</Typography>
          <RolloutLine w={op} what="ceph-csi-controller-manager" />
          {opPods.map(p => {
            const h = podHealth(p);
            return (
              <Box key={p.metadata.name} sx={{ fontSize: 12.5, mt: 0.5, color: t.muted, ...tabular }}>
                <Mono muted>{p.metadata.name}</Mono>, {plural(h.restarts, 'restart')}, up {age(p.status?.startTime)}
              </Box>
            );
          })}
          <Images w={op} />
          {operatorConfigs.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.5 }}>
                Defaults for every driver (OperatorConfig <Mono>{operatorConfigs[0].metadata.name}</Mono>)
              </Typography>
              <KV
                labelWidth={150}
                rows={[
                  ['Image set', defaults?.imageSet?.name ? <Mono key="is">{defaults.imageSet.name}</Mono> : 'Built in'],
                  ['Kubelet directory', <Mono key="kd">{defaults?.nodePlugin?.kubeletDirPath ?? '/var/lib/kubelet'}</Mono>],
                  ['Log verbosity', defaults?.log?.verbosity ?? '—'],
                  ['Controller replicas', defaults?.controllerPlugin?.replicas ?? '—'],
                ]}
              />
            </Box>
          )}
        </Box>
        <Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1 }}>Ceph connections</Typography>
          <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.75 }}>The monitors each driver connects to.</Typography>
          {cephConnections.length ? (
            cephConnections.map(c => (
              <Box key={`${c.metadata.namespace}/${c.metadata.name}`} sx={{ mb: 1 }}>
                <Mono>{c.metadata.name}</Mono>
                <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 12.5, color: t.muted }}>
                  {(c.spec?.monitors ?? []).map((m: string) => (
                    <li key={m}>
                      <Mono>{m}</Mono>
                    </li>
                  ))}
                </Box>
                {c.spec?.rbdMirrorDaemonCount !== undefined && <Typography sx={{ fontSize: 12.5, color: t.muted }}>RBD mirror daemons: {c.spec.rbdMirrorDaemonCount}</Typography>}
              </Box>
            ))
          ) : (
            <Typography sx={{ fontSize: 13, color: t.muted }}>None visible.</Typography>
          )}
        </Box>
        <Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1 }}>Client profiles</Typography>
          <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.75 }}>What a clusterID means: connection, secrets, subvolume group, RADOS namespace.</Typography>
          {clientProfiles.length ? (
            clientProfiles.map(c => {
              const ready = c.status?.phase === 'Ready';
              const sec = (x: any) => (x?.name ? `${x.namespace ? `${x.namespace}/` : ''}${x.name}` : '—');
              return (
                <Box key={`${c.metadata.namespace}/${c.metadata.name}`} sx={{ mb: 1.5 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
                    <Mono>{c.metadata.name}</Mono>
                    {c.status?.phase && (
                      <StateLabel tone={ready ? 'ok' : 'warn'} size="sm" title={c.status?.message}>
                        {c.status.phase}
                      </StateLabel>
                    )}
                  </Box>
                  <KV
                    labelWidth={140}
                    rows={[
                      ['Connection', <Mono key="c">{c.spec?.cephConnectionRef?.name ?? '—'}</Mono>],
                      !!c.spec?.rbd && ['RBD secrets', <Mono key="r">{`${sec(c.spec.rbd.cephCsiSecrets?.controllerPublishSecret)}, ${sec(c.spec.rbd.cephCsiSecrets?.nodePublishSecret)}`}</Mono>],
                      !!c.spec?.rbd?.radosNamespace && ['RADOS namespace', <Mono key="rn">{c.spec.rbd.radosNamespace}</Mono>],
                      !!c.spec?.cephFs && ['CephFS secrets', <Mono key="f">{`${sec(c.spec.cephFs.cephCsiSecrets?.controllerPublishSecret)}, ${sec(c.spec.cephFs.cephCsiSecrets?.nodePublishSecret)}`}</Mono>],
                      !!c.spec?.cephFs?.subVolumeGroup && ['Subvolume group', <Mono key="sv">{c.spec.cephFs.subVolumeGroup}</Mono>],
                      !!c.status?.message && ['Status', c.status.message],
                    ]}
                  />
                </Box>
              );
            })
          ) : (
            <Typography sx={{ fontSize: 13, color: t.muted }}>None visible.</Typography>
          )}
        </Box>
      </Box>
    </Panel>
  );
}
