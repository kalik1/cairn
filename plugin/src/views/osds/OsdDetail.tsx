/*
 * One OSD (/ceph/osds/:id): its drive, state and weights, the device and
 * pod behind it, operations with their checks, commit/apply latency, its
 * placement groups and Ceph's full metadata.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { mon } from '../../api/bridge';
import { out, useCeph, useCephQuery } from '../../api/ceph';
import { bytes, ms, pct, plural } from '../../model/format';
import { backing, fillWord, osdStateWord, ratiosOf } from '../../model/osd';
import { PG_CATEGORY_INFO,pgsOfOsd } from '../../model/pg';
import { Osd } from '../../model/types';
import { useNav } from '../../shell/nav';
import { TimeChart } from '../../ui/charts';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Band, Empty, KV, Mono, Notice, Page, Panel, ToolButton } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { SERIES, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { Collapsible, Hint, NodeLink, PodLink, useCephReason, ViewLink } from '../overview/common';
import { Bay } from './HostShelves';
import { markIn, markOut, openMaintenance, openReweight, SafetyCheck, scrub, setNoout } from './ops';

type PgRow = ReturnType<typeof pgsOfOsd>[number];

/** Placement groups listed before "Show all" (the not-clean ones come first). */
const PG_ROWS = 50;

function BandFact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  const t = useTokens();
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ fontSize: 12.5, color: t.basaltMuted }}>{label}</Box>
      <Box sx={{ fontSize: 18, fontWeight: 600, color: t.basaltText, ...tabular }}>{value}</Box>
      {sub && <Box sx={{ fontSize: 12.5, color: t.basaltMuted, ...tabular }}>{sub}</Box>}
    </Box>
  );
}

export function OsdDetail({ osd }: { osd: Osd }) {
  const t = useTokens();
  const c = useCeph();
  const nav = useNav();
  const reason = useCephReason();
  const r = ratiosOf(c.core.osdMap);
  const b = backing(osd);
  const [err, setErr] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(0);
  const [allPgs, setAllPgs] = React.useState(false);
  const pgs = React.useMemo(
    () => pgsOfOsd(c.core.pgs, osd.id).sort((a, b) => (a.category === 'clean' ? 1 : 0) - (b.category === 'clean' ? 1 : 0)),
    [c.core.pgs, osd.id]
  );
  const primaries = pgs.filter(p => p.primaryHere).length;
  const poolName = (id: number) => c.core.pools.find(p => p.id === id)?.name ?? `pool ${id}`;
  const metaQ = useCephQuery(`osds.meta.${osd.id}`, [mon('osd metadata', { id: osd.id })], { staleMs: 60000 });
  const meta = out<Record<string, unknown>>(metaQ.data);
  const noout = osd.flags.includes('noout');
  const run = async (f: () => Promise<void>) => {
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const host = c.core.hosts.find(h => h.osds.includes(osd.id));

  const pgCols: Column<PgRow>[] = [
    { id: 'pgid', header: 'PG', cell: p => <Mono>{p.pgid}</Mono>, sort: p => p.pool * 1e6 + parseInt(p.pgid.split('.')[1] ?? '0', 16), width: 80 },
    {
      id: 'pool',
      header: 'Pool',
      cell: p => (
        <ViewLink view="pools" a={poolName(p.pool)}>
          {poolName(p.pool)}
        </ViewLink>
      ),
      sort: p => poolName(p.pool),
    },
    {
      id: 'state',
      header: 'State',
      cell: p => (
        <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
          <StateLabel tone={PG_CATEGORY_INFO[p.category].tone}>{PG_CATEGORY_INFO[p.category].label}</StateLabel>
          <Mono muted>{p.state}</Mono>
        </Box>
      ),
      sort: p => p.state,
    },
    {
      id: 'role',
      header: 'Role here',
      cell: p => (p.primaryHere ? 'Primary' : !p.acting.includes(osd.id) ? 'Joining (CRUSH wants it here)' : !p.upHere ? 'Leaving (moving away)' : 'Replica'),
      sort: p => (p.primaryHere ? 0 : 1),
    },
    { id: 'acting', header: 'Acting set', cell: p => <Mono>{p.acting.map(x => `osd.${x}`).join(', ')}</Mono>, minWidth: 700 },
  ];

  return (
    <Page
      title={osd.name}
      subtitle={`${osdStateWord(osd)} on ${b.node || osd.host || 'an unknown host'}: ${bytes(osd.sizeBytes)} ${osd.deviceClass || ''} drive, ${Math.round(
        osd.utilization
      )}% used.`}
      actions={
        <ToolButton icon="mdi:arrow-left" onClick={() => nav.go('osds')}>
          All OSDs
        </ToolButton>
      }
    >
      <Band>
        <Box sx={{ display: 'flex', gap: { xs: 2, md: 4 }, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Bay osd={osd} r={r} large />
          <Box sx={{ flex: 1, minWidth: 280, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 2.5 }}>
            <BandFact label="State" value={osdStateWord(osd)} sub={osd.status !== (osd.up ? 'up' : 'down') ? osd.status : undefined} />
            <BandFact label="Fill" value={pct(osd.utilization / 100)} sub={fillWord(osd.utilization, r)} />
            <BandFact label="Used" value={bytes(osd.usedBytes)} sub={`${bytes(osd.availBytes)} free of ${bytes(osd.sizeBytes)}`} />
            <BandFact label="Placement groups" value={osd.pgs} sub={`${primaries} as primary`} />
            <BandFact label="Commit / apply latency" value={osd.commitMs === undefined ? '—' : `${ms(osd.commitMs)} / ${ms(osd.applyMs)}`} />
            <BandFact label="Reweight" value={osd.reweight.toFixed(2)} sub={`CRUSH weight ${osd.crushWeight.toFixed(3)}`} />
            <BandFact label="Variance" value={osd.variance.toFixed(2)} sub="fill against the average" />
            <BandFact label="Flags" value={osd.flags.length ? osd.flags.join(', ') : 'none'} />
          </Box>
        </Box>
      </Band>
      {err && (
        <Notice tone="err" title="The operation failed">
          {err}
        </Notice>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
        <Panel title="Operations" icon="mdi:wrench-outline">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <OpRow text={osd.in ? 'Move all its data to other OSDs (before removing or replacing the disk).' : 'Let Ceph place data on it again.'}>
              {osd.in ? (
                <Action icon="mdi:logout-variant" onClick={() => run(() => markOut(c.ns, [osd], c.refresh))} reason={reason}>
                  Mark out
                </Action>
              ) : (
                <Action icon="mdi:login-variant" onClick={() => run(() => markIn(c.ns, [osd], c.refresh))} reason={reason}>
                  Mark in
                </Action>
              )}
            </OpRow>
            <OpRow text="Give it a smaller or larger share of data (temporary override, 0 to 1).">
              <Action icon="mdi:scale-balance" onClick={() => openReweight(c.ns, osd, c.refresh)} reason={reason}>
                Reweight…
              </Action>
            </OpRow>
            <OpRow text={noout ? 'Ceph will not mark it out while noout is set.' : 'Keep it in while it is down for a short time.'}>
              <Action icon={noout ? 'mdi:play-circle-outline' : 'mdi:pause-circle-outline'} onClick={() => run(() => setNoout(c.ns, [osd], !noout, c.refresh))} reason={reason}>
                {noout ? 'Clear noout' : 'Set noout'}
              </Action>
            </OpRow>
            <OpRow text="Check its copies now: scrub compares metadata, deep scrub reads every byte.">
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Action icon="mdi:magnify-scan" onClick={() => run(() => scrub(c.ns, [osd], false, c.refresh))} reason={reason}>
                  Scrub
                </Action>
                <Action icon="mdi:layers-search-outline" onClick={() => run(() => scrub(c.ns, [osd], true, c.refresh))} reason={reason}>
                  Deep scrub
                </Action>
              </Box>
            </OpRow>
            <OpRow text="Take it down for work (disk swap, reboot) without Ceph reacting as if it failed.">
              <Action icon="mdi:shield-check-outline" onClick={() => openMaintenance(c.ns, { osds: [osd], node: b.node }, c.refresh)} reason={reason}>
                Maintenance…
              </Action>
            </OpRow>
            <OpRow text="Ask Ceph whether stopping or removing it would make data unavailable or lose it.">
              <Action icon="mdi:shield-search" onClick={() => setChecking(n => n + 1)} reason={reason}>
                {checking ? 'Check again' : 'Check safety'}
              </Action>
            </OpRow>
            {checking > 0 && <SafetyCheck key={checking} ids={[osd.id]} stop destroy />}
          </Box>
        </Panel>
        <Panel title="Backing device and pod" icon="mdi:harddisk">
          <KV
            labelWidth={150}
            rows={[
              ['Node', <NodeLink key="n" name={b.node} />],
              ['CRUSH host', host ? <Mono key="h">{host.name}</Mono> : osd.host || '—'],
              ['Device', b.device ? <Mono key="d">{b.device}</Mono> : '—'],
              ['Device path', b.path ? <Mono key="p">{b.path}</Mono> : '—'],
              ['Device id', b.deviceId ? <Mono key="i">{b.deviceId}</Mono> : '—'],
              ['Rotational', b.rotational === null ? '—' : b.rotational ? 'Yes (spinning disk)' : 'No (solid state)'],
              ['Object store', b.type || '—'],
              ['Device class', osd.deviceClass || '—'],
              ['Pod', <PodLink key="pod" namespace={b.podNamespace} name={b.pod} />],
              ['Ceph version', osd.meta?.version || '—'],
              ['Kernel', osd.meta?.kernel || '—'],
            ]}
          />
        </Panel>
      </Box>
      <Panel title="Latency" icon="mdi:timer-outline" actions={<Hint>Last 30 minutes, since Cairn opened</Hint>}>
        <TimeChart
          kind="line"
          latest
          format={ms}
          series={[
            { name: 'Commit', key: `osd.${osd.id}.commitMs`, color: SERIES.latency },
            { name: 'Apply', key: `osd.${osd.id}.applyMs`, color: SERIES.read },
          ]}
        />
      </Panel>
      <Panel
        title="Placement groups"
        icon="mdi:grid"
        dense
        actions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Hint>
              {plural(pgs.length, 'placement group')}, {primaries} as primary
            </Hint>
            {pgs.length > PG_ROWS && <Action onClick={() => setAllPgs(v => !v)}>{allPgs ? `Show the first ${PG_ROWS}` : `Show all ${pgs.length}`}</Action>}
          </Box>
        }
      >
        <DataTable
          label={`Placement groups of ${osd.name}`}
          rows={allPgs ? pgs : pgs.slice(0, PG_ROWS)}
          columns={pgCols}
          rowKey={p => p.pgid}
          initialSort={{ id: 'pgid', dir: 'asc' }}
          empty={<Empty icon="mdi:grid-off" title="No placement groups">This OSD holds no placement group (out, or new and empty).</Empty>}
        />
      </Panel>
      <Panel title="Metadata" icon="mdi:card-text-outline">
        {metaQ.error && <Notice tone="err">{metaQ.error}</Notice>}
        {!meta && !metaQ.error && <Hint>Reading the metadata…</Hint>}
        {meta && (
          <Collapsible title="Everything Ceph knows about this OSD" count={Object.keys(meta).length}>
            <KV
              labelWidth={260}
              rows={Object.entries(meta)
                .sort(([a], [z]) => a.localeCompare(z))
                .map(([k, v]) => [<Mono key={k}>{k}</Mono>, <Box key={`${k}-v`} component="span" sx={{ fontFamily: t.font.mono, fontSize: 12.5 }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</Box>])}
            />
          </Collapsible>
        )}
      </Panel>
    </Page>
  );
}

function OpRow({ text, children }: { text: string; children: React.ReactNode }) {
  const t = useTokens();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <Typography sx={{ fontSize: 13.5, color: t.muted, flex: 1, minWidth: 220 }}>{text}</Typography>
      {children}
    </Box>
  );
}

export function OsdMissing({ id }: { id: string }) {
  const nav = useNav();
  return (
    <Page title={`osd.${id}`}>
      <Empty
        icon="mdi:harddisk-remove"
        title={`No OSD osd.${id}`}
        action={
          <Action icon="mdi:arrow-left" onClick={() => nav.go('osds')}>
            Show all OSDs
          </Action>
        }
      >
        Ceph does not list an OSD with this id. It may have been removed, or the link is wrong.
      </Empty>
    </Page>
  );
}

