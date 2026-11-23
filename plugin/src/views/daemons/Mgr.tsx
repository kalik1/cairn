/*
 * Managers: the active one and its standbys, how many Rook runs (and
 * changing it), the services they publish (dashboard, Prometheus), and
 * every mgr module with its state; enable or disable a module behind a
 * confirmation, or drop an entry Rook ignores from the CephCluster.
 */

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import React from 'react';
import { mon } from '../../api/bridge';
import { out, useCeph, useCephQuery } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { cephOp } from '../../api/osdOps';
import { ignoredModuleReason, runningCephVersion } from '../../model/daemonCounts';
import { ago } from '../../model/format';
import { cliText } from '../../model/health';
import { Column, DataTable } from '../../ui/DataTable';
import { confirm } from '../../ui/dialogs';
import { Action, Empty, KV, Mono, Notice, Panel, Tag } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { StateTone } from '../../ui/tokens';
import { CommandList, Hint, NodeLink, PodLink, useCephReason } from '../overview/common';
import { MgrCountPanel, previewRemoveModule, useModulesEditReason } from './counts';

const MODULE_TEXT: Record<string, string> = {
  alerts: 'Sends health alerts by e-mail.',
  balancer: 'Evens out placement groups across OSDs.',
  cephadm: 'The cephadm orchestrator (not used with Rook).',
  crash: 'Collects and lists daemon crash reports.',
  dashboard: 'The Ceph web dashboard.',
  devicehealth: 'Watches disk health (SMART) and predicts failures.',
  diskprediction_local: 'Predicts disk failures from SMART data, locally.',
  influx: 'Sends statistics to InfluxDB.',
  insights: 'Gathers a report for support.',
  iostat: 'Prints client I/O statistics (ceph iostat).',
  k8sevents: 'Sends Ceph events to Kubernetes as events.',
  localpool: 'Creates a pool per host or rack automatically.',
  mds_autoscaler: 'Adjusts the number of MDS daemons.',
  mirroring: 'CephFS snapshot mirroring.',
  nfs: 'Manages NFS exports over CephFS and RGW.',
  nvmeof: 'Manages NVMe-oF gateways.',
  orchestrator: 'The orchestrator interface (Rook or cephadm behind it).',
  osd_perf_query: 'Per-client OSD performance queries.',
  osd_support: 'Helpers for OSD removal.',
  pg_autoscaler: 'Adjusts the placement-group count of pools.',
  progress: 'Tracks long operations (recovery, rebalancing) with progress events.',
  prometheus: 'Exports metrics for Prometheus.',
  rbd_support: 'RBD background tasks, trash purge, mirroring snapshots, performance.',
  rgw: 'Deploys RGW zones (cephadm).',
  rook: 'The Rook orchestrator backend: lets Ceph ask Rook to create daemons.',
  selftest: 'Tests for the manager itself.',
  smb: 'Manages SMB shares.',
  snap_schedule: 'Scheduled CephFS snapshots.',
  stats: 'CephFS performance statistics.',
  status: 'The "ceph fs status" and "ceph osd status" commands.',
  telegraf: 'Sends statistics to Telegraf.',
  telemetry: 'Sends anonymous usage reports to the Ceph project, if opted in.',
  test_orchestrator: 'A fake orchestrator for tests.',
  volumes: 'CephFS volumes and subvolumes (used by Ceph-CSI).',
};

interface ModuleRow {
  name: string;
  state: 'always' | 'enabled' | 'available' | 'broken';
  error?: string;
  rook?: boolean;
}

const STATE_WORD: Record<ModuleRow['state'], [string, StateTone]> = {
  always: ['Always on', 'ok'],
  enabled: ['Enabled', 'ok'],
  available: ['Available', 'idle'],
  broken: ['Cannot run', 'warn'],
};

const names = (v: unknown): string[] => (Array.isArray(v) ? v.map((x: any) => String(x?.name ?? x)) : v && typeof v === 'object' ? Object.values(v as any).flatMap(names) : []);

export function Mgr() {
  const c = useCeph();
  const kube = useKube();
  const reason = useCephReason();
  const m = c.core.mgr;
  const metaQ = useCephQuery('daemons.mgrmeta', [mon('mgr metadata')], { staleMs: 60000 });
  const meta = out<any[]>(metaQ.data) ?? [];
  const modQ = useCephQuery('daemons.modules', [mon('mgr module ls')], { staleMs: 30000 });
  const mods = out<any>(modQ.data);
  const [filter, setFilter] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const rookMods = new Map<string, boolean>(((kube.cephCluster?.spec?.mgr?.modules ?? []) as any[]).map(x => [String(x?.name), x?.enabled !== false]));
  const cephVersion = runningCephVersion(kube.cephCluster, c.core.versions);
  const ignored = (name: string) => ignoredModuleReason(kube.cephCluster, name, cephVersion);
  const modulesReason = useModulesEditReason();
  const rows: ModuleRow[] = React.useMemo(() => {
    if (!mods) return [];
    const always = new Set(names(mods.always_on_modules));
    const enabled = new Set(names(mods.enabled_modules));
    const out: ModuleRow[] = [];
    for (const n of always) out.push({ name: n, state: 'always' });
    for (const n of enabled) if (!always.has(n)) out.push({ name: n, state: 'enabled' });
    for (const d of Array.isArray(mods.disabled_modules) ? mods.disabled_modules : []) {
      const n = String(d?.name ?? d);
      if (always.has(n) || enabled.has(n)) continue;
      out.push({ name: n, state: d?.can_run === false ? 'broken' : 'available', error: d?.error_string || undefined });
    }
    return out.map(r => ({ ...r, rook: rookMods.has(r.name) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mods, kube.cephCluster]);
  const shown = rows.filter(r => !filter || r.name.includes(filter.toLowerCase()) || (MODULE_TEXT[r.name] ?? '').toLowerCase().includes(filter.toLowerCase()));

  const toggle = async (r: ModuleRow, on: boolean) => {
    const cmd = { prefix: on ? 'mgr module enable' : 'mgr module disable', module: r.name };
    const ok = await confirm({
      title: on ? `Enable the ${r.name} module?` : `Disable the ${r.name} module?`,
      body: <CommandList cmds={[cliText(cmd)]} />,
      consequences: on
        ? [
            `The active manager loads ${r.name}: ${MODULE_TEXT[r.name] ?? 'its feature becomes available.'}`,
            'Standby managers load it when they take over.',
          ]
        : [
            `${r.name} stops on every manager: ${MODULE_TEXT[r.name] ?? 'its feature is no longer available.'}`,
            ...(r.rook ? [`The CephCluster lists ${r.name} in spec.mgr.modules: Rook enables it again at its next reconcile. Change it there instead.`] : []),
            ...(r.name === 'prometheus' ? ['Prometheus scrapes of Ceph metrics fail until it is enabled again.'] : []),
            ...(r.name === 'dashboard' ? ['The Ceph dashboard goes away.'] : []),
          ],
      confirm: on ? 'Enable' : 'Disable',
      danger: !on,
    });
    if (!ok) return;
    setErr(null);
    try {
      await cephOp(c.ns, { title: `${on ? 'Enable' : 'Disable'} the mgr module ${r.name}`, target: `mgr module ${r.name}`, cmd, invalidate: 'daemons.modules', after: c.refresh });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const removeEntry = async (r: ModuleRow) => {
    if (!kube.cephCluster) return;
    setErr(null);
    try {
      await previewRemoveModule(kube.cephCluster, r.name, cephVersion, () => kube.refresh());
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const cols: Column<ModuleRow>[] = [
    { id: 'name', header: 'Module', cell: r => <Mono>{r.name}</Mono>, sort: r => r.name, width: 180 },
    {
      id: 'state',
      header: 'State',
      cell: r => <StateLabel tone={STATE_WORD[r.state][1]}>{STATE_WORD[r.state][0]}</StateLabel>,
      sort: r => ['always', 'enabled', 'available', 'broken'].indexOf(r.state),
      width: 130,
    },
    {
      id: 'what',
      header: 'What it does',
      cell: r => (
        <Box component="span" sx={{ whiteSpace: 'normal' }}>
          {r.error ? <Box component="span" sx={{ color: 'warning.main' }}>{r.error}. </Box> : null}
          {MODULE_TEXT[r.name] ?? ''}
          {r.rook && (
            <>
              {' '}
              {r.state === 'available' && rookMods.get(r.name) ? (
                <>
                  <Tag tone="warn" title={ignored(r.name) ?? 'Rook did not enable it: the operator log says why'}>
                    Listed in the CephCluster, not enabled
                  </Tag>
                  {ignored(r.name) && <Hint sx={{ mt: 0.5 }}>{ignored(r.name)}</Hint>}
                </>
              ) : (
                <Tag title="spec.mgr.modules in the CephCluster">Set in the CephCluster</Tag>
              )}
            </>
          )}
        </Box>
      ),
      width: 520,
    },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: r =>
        ignored(r.name) && r.state !== 'enabled' ? (
          <Action onClick={() => removeEntry(r)} reason={modulesReason}>
            Remove from the CephCluster
          </Action>
        ) : r.state === 'always' ? (
          <Hint>Cannot be disabled</Hint>
        ) : r.state === 'enabled' ? (
          <Action onClick={() => toggle(r, false)} reason={reason}>
            Disable
          </Action>
        ) : (
          <Action onClick={() => toggle(r, true)} reason={reason ?? (r.state === 'broken' ? 'It cannot run here' : null)}>
            Enable
          </Action>
        ),
    },
  ];
  const services = Object.entries(m?.services ?? c.core.status?.mgr.services ?? {});
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        <Panel title="Managers" icon="mdi:account-tie-outline">
          {m && !m.standbys.length && (
            <Notice tone="warn" sx={{ mb: 1.5 }} title="No standby">
              If mgr.{m.active} stops, metrics, the dashboard, progress events, the PG autoscaler and the balancer stop until it is back. Run
              two managers: choose 2 under How many managers.
            </Notice>
          )}
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {[...(m?.active ? [{ name: m.active, active: true }] : []), ...(m?.standbys ?? []).map(n => ({ name: n, active: false }))].map(x => {
              const md = meta.find(y => y?.name === x.name);
              return (
                <Box component="li" key={x.name} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Mono>mgr.{x.name}</Mono>
                    <StateLabel tone={x.active ? (m?.available ? 'ok' : 'err') : 'idle'}>{x.active ? (m?.available ? 'Active' : 'Active, not available') : 'Standby'}</StateLabel>
                    {x.active && m?.activeSince && <Hint>since {ago(m.activeSince)}</Hint>}
                  </Box>
                  <KV
                    labelWidth={110}
                    rows={[
                      ['Pod', <PodLink key="p" namespace={md?.pod_namespace} name={md?.pod_name} />],
                      ['Node', <NodeLink key="n" name={md?.hostname} />],
                      ['Version', md?.ceph_version_short ?? '—'],
                    ]}
                  />
                </Box>
              );
            })}
          </Box>
          {!m && <Hint>Reading the manager map…</Hint>}
        </Panel>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <MgrCountPanel />
          <Panel title="Services" icon="mdi:web">
          {services.length === 0 ? (
            <Hint>The managers publish no service.</Hint>
          ) : (
            <KV
              rows={services.map(([k, v]) => [
                k,
                <Link key={k} href={String(v)} target="_blank" rel="noopener noreferrer" underline="hover">
                  <Mono>{String(v)}</Mono>
                </Link>,
              ])}
            />
          )}
          <Hint sx={{ mt: 1 }}>These are addresses inside the cluster network: they open only from where the pod network is reachable.</Hint>
          </Panel>
        </Box>
      </Box>
      <Panel
        title="Modules"
        icon="mdi:puzzle-outline"
        dense
        actions={
          <TextField size="small" placeholder="Filter modules" value={filter} onChange={e => setFilter(e.target.value)} inputProps={{ 'aria-label': 'Filter modules' }} sx={{ width: 200 }} />
        }
      >
        {modQ.error && (
          <Notice tone="err" sx={{ m: 1.5 }} title="Could not list the modules">
            {modQ.error}
          </Notice>
        )}
        {err && (
          <Notice tone="err" sx={{ m: 1.5 }} title="The module change failed">
            {err}
          </Notice>
        )}
        {!mods && !modQ.error ? (
          <Hint sx={{ p: 2 }}>Reading the module list…</Hint>
        ) : (
          <DataTable
            label="Manager modules"
            rows={shown}
            columns={cols}
            rowKey={r => r.name}
            initialSort={{ id: 'state', dir: 'asc' }}
            empty={<Empty icon="mdi:puzzle-remove-outline" title="No module matches">Clear the filter to see every module.</Empty>}
          />
        )}
      </Panel>
    </Box>
  );
}
