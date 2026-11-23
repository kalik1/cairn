/*
 * Ceph settings: the central configuration ("config dump") grouped by who
 * it applies to, searchable; the option's help beside it ("config help");
 * set a value or remove an override, each reviewed with the exact command.
 * Options the CephCluster manages are marked and edited through it. Recent
 * changes come from "config log". Values that may hold secrets are hidden.
 */

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import React from 'react';
import { mon } from '../../api/bridge';
import { out, outError, useCeph, useCephQuery } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { displayValue, groupConfig, HIDDEN, ManagedBy, managedBy, normName, parseConfigLog, ROOK_DEFAULTS, rookManaged, searchConfig, whoOf } from '../../model/config';
import { parseConfig } from '../../model/parse';
import { ConfigEntry } from '../../model/types';
import { LiveGate,Loading } from '../../shell/Gate';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Empty, IconAction, KV, Mono, Notice, Panel, Tag, Toolbar, When } from '../../ui/kit';
import { useTokens } from '../../ui/useTokens';
import { SearchField, Split } from '../kubernetes/parts';
import { CurrentValue, openRemoveDialog, openSetDialog, useConfigHelp } from './ConfigDialogs';

interface Row extends ConfigEntry {
  who: string;
  managed?: ManagedBy;
  /** In the CephCluster spec but not (yet) in Ceph. */
  pending?: boolean;
}

const key = (r: { who: string; name: string }) => `${r.who}|${r.name}`;

function SourceTag({ m, pending }: { m?: ManagedBy; pending?: boolean }) {
  if (pending) return <Tag tone="move" title="In the CephCluster spec; Rook has not set it in Ceph yet">Rook, not applied</Tag>;
  if (!m) return null;
  if (m.by === 'spec') return <Tag tone="accent" title="CephCluster spec.cephConfig">Rook spec</Tag>;
  if (m.by === 'secret') return <Tag tone="accent" title={`CephCluster spec.cephConfigFromSecret (${m.secret})`}>Rook secret</Tag>;
  return <Tag title="Rook sets this option itself">Set by Rook</Tag>;
}

export function SettingsTab() {
  return (
    <LiveGate what="Ceph settings">
      <Settings />
    </LiveGate>
  );
}

function Settings() {
  const t = useTokens();
  const kube = useKube();
  const ceph = useCeph();
  const dump = useCephQuery('config.dump', [mon('config dump')], { staleMs: 4000 });
  const [q, setQ] = React.useState('');
  const [grouped, setGrouped] = React.useState(true);
  const [sel, setSel] = React.useState<{ who: string; name: string } | null>(null);
  const cluster = kube.cephCluster;
  const managed = React.useMemo(() => rookManaged(cluster), [cluster]);
  const rows: Row[] = React.useMemo(() => {
    const raw = out(dump.data);
    const list: Row[] = (raw ? parseConfig(raw) : []).map(e => ({ ...e, who: whoOf(e), managed: managedBy(managed, whoOf(e), e.name) }));
    const have = new Set(list.map(key));
    for (const m of managed.values()) {
      if (m.by !== 'spec' || have.has(`${m.who}|${normName(m.name)}`)) continue;
      list.push({ section: m.who, mask: '', name: normName(m.name), value: m.value, level: '', runtime: true, who: m.who, managed: m, pending: true });
    }
    return list;
  }, [dump.data, managed]);
  const shown = React.useMemo(() => searchConfig(rows, q), [rows, q]);
  const groups = React.useMemo(() => groupConfig(shown), [shown]);
  const current: CurrentValue[] = rows.filter(r => !r.pending).map(r => ({ who: r.who, name: r.name, value: r.value }));
  const selected = sel ? rows.find(r => r.who === sel.who && r.name === sel.name) ?? null : null;
  const reason = ceph.phase !== 'ready' ? ceph.reason : null;
  const dumpErr = outError(dump.data);

  const cols: Column<Row>[] = [
    ...(grouped ? [] : [{ id: 'who', header: 'Who', cell: (r: Row) => <Mono>{r.who}</Mono>, sort: (r: Row) => r.who, width: 180 } as Column<Row>]),
    {
      id: 'name',
      header: 'Option',
      cell: r => <Mono>{r.name}</Mono>,
      sort: r => r.name,
      width: 360,
    },
    {
      id: 'value',
      header: 'Value',
      cell: r => {
        const v = displayValue(r.name, r.value);
        return (
          <Box component="span" title={v} sx={{ fontStyle: v === HIDDEN ? 'italic' : undefined }}>
            <Mono>{v === '' ? "''" : v}</Mono>
          </Box>
        );
      },
      sort: r => displayValue(r.name, r.value),
      width: 360,
    },
    { id: 'level', header: 'Level', cell: r => r.level || '—', sort: r => r.level, minWidth: 900 },
    { id: 'runtime', header: 'Takes effect', cell: r => (r.pending ? '—' : r.runtime ? 'At once' : 'At restart'), sort: r => String(r.runtime), minWidth: 1000 },
    { id: 'src', header: 'Managed', cell: r => <SourceTag m={r.managed} pending={r.pending} />, sort: r => r.managed?.by ?? '' },
  ];

  if (!dump.data && !dump.error) return <Loading label="Reading Ceph’s configuration…" />;

  return (
    <Split
      side={
        <>
          {selected || sel ? (
            <HelpPanel row={selected} sel={sel!} current={current} onClose={() => setSel(null)} onPick={n => setSel({ who: sel!.who, name: n })} reason={reason} />
          ) : (
            <Panel title="About these settings" icon="mdi:information-outline">
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
                Ceph keeps its options in a central database on the monitors; every daemon reads it. This list shows the options set there (the rest use
                Ceph’s defaults). Select one to see what it does and to change it.
              </Typography>
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.55, mt: 1 }}>
                <Tag tone="accent">Rook spec</Tag> options come from the CephCluster (spec.cephConfig): change them there, or Rook sets them back.{' '}
                <Tag>Set by Rook</Tag> options are Rook’s own defaults.
              </Typography>
            </Panel>
          )}
          <History />
        </>
      }
    >
      {dump.error && <Notice tone="err" title="Ceph did not answer">{dump.error}</Notice>}
      {dumpErr && <Notice tone="err" title="config dump failed">{dumpErr}</Notice>}
      <Panel dense>
        <Toolbar sx={{ gap: 1, py: 1 }}>
          <SearchField value={q} onChange={setQ} placeholder="Search options, who, values" width={300} name="cfg-search" />
          <FormControlLabel
            sx={{ ml: 0.5 }}
            control={<Switch size="small" checked={grouped} onChange={e => setGrouped(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13.5 }}>Group by who</Typography>}
          />
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12.5, color: t.muted }}>{shown.length === rows.length ? `${rows.length} set` : `${shown.length} of ${rows.length}`}</Typography>
          <Action icon="mdi:plus" variant="contained" reason={reason} onClick={() => openSetDialog({ current, cluster })}>
            Set a value
          </Action>
        </Toolbar>
        {grouped ? (
          groups.length ? (
            groups.map(g => (
              <Box key={g.who} sx={{ '&:not(:last-of-type)': { borderBottom: `1px solid ${t.rule}` } }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: 1.25, pt: 1.25, pb: 0.25 }}>
                  <Mono>{g.who}</Mono>
                  <Typography component="span" sx={{ fontSize: 12.5, color: t.muted }}>
                    {whoWords(g.who)}, {g.entries.length}
                  </Typography>
                </Box>
                <DataTable
                  label={`Options for ${g.who}`}
                  rows={g.entries}
                  columns={cols}
                  rowKey={key}
                  onOpen={r => setSel(s => (s && key(s) === key(r) ? null : { who: r.who, name: r.name }))}
                  activeKey={sel ? key(sel) : undefined}
                />
              </Box>
            ))
          ) : (
            <NoMatch q={q} />
          )
        ) : (
          <DataTable
            label="Ceph options"
            rows={shown}
            columns={cols}
            rowKey={key}
            onOpen={r => setSel(s => (s && key(s) === key(r) ? null : { who: r.who, name: r.name }))}
            activeKey={sel ? key(sel) : undefined}
            empty={<NoMatch q={q} />}
          />
        )}
      </Panel>
    </Split>
  );
}

function NoMatch({ q }: { q: string }) {
  return q ? (
    <Empty icon="mdi:filter-off-outline" title="No option matches">
      Nothing set matches “{q}”. Options at their defaults are not listed: use Set a value to set one.
    </Empty>
  ) : (
    <Empty icon="mdi:tune-variant" title="Every option is at its default">
      Use Set a value to change one.
    </Empty>
  );
}

function whoWords(who: string): string {
  const [base, mask] = who.split('/');
  const type = base.split('.')[0];
  const words: Record<string, string> = { global: 'every daemon and client', mon: 'monitors', mgr: 'managers', osd: 'OSDs', mds: 'metadata servers', client: 'clients' };
  let w = base.includes('.') ? `${type} ${base.slice(type.length + 1)}` : words[type] ?? type;
  if (base.startsWith('client.rgw')) w = 'an object gateway';
  if (mask) w += ` on ${mask.replace(':', ' ')}`;
  return w;
}

function HelpPanel({
  row,
  sel,
  current,
  onClose,
  onPick,
  reason,
}: {
  row: Row | null;
  sel: { who: string; name: string };
  current: CurrentValue[];
  onClose: () => void;
  onPick: (name: string) => void;
  reason: string | null;
}) {
  const t = useTokens();
  const kube = useKube();
  const cluster = kube.cephCluster;
  const isModule = sel.name.includes('/');
  const { help, loading, missing, error } = useConfigHelp(isModule ? null : sel.name);
  const shown = row ? displayValue(row.name, row.value) : null;
  const rookDefault = ROOK_DEFAULTS.find(d => d.who === sel.who && d.name === sel.name);
  return (
    <Panel
      title={<Mono>{sel.name}</Mono>}
      icon="mdi:tune-variant"
      actions={<IconAction icon="mdi:close" label="Close" onClick={onClose} />}
      footer={
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Action
            icon="mdi:pencil-outline"
            reason={row?.managed?.by === 'secret' ? 'Set from a Secret by Rook (cephConfigFromSecret)' : row?.managed?.by === 'spec' ? null : reason}
            onClick={() => openSetDialog({ initial: { who: sel.who, name: sel.name, value: row?.value ?? help?.default ?? '' }, current, cluster })}
          >
            {row ? 'Change value' : 'Set a value'}
          </Action>
          {row && !row.pending && (
            <Action
              icon="mdi:undo-variant"
              color="error"
              reason={row.managed?.by === 'secret' ? 'Set from a Secret by Rook (cephConfigFromSecret)' : row.managed?.by === 'spec' ? null : reason}
              onClick={() => openRemoveDialog({ entry: { who: row.who, name: row.name, value: row.value }, cluster })}
            >
              Remove override
            </Action>
          )}
        </Box>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <KV
          labelWidth={120}
          rows={[
            ['Who', <Mono key="w">{sel.who}</Mono>],
            ['Value', row ? <Mono key="v">{shown === '' ? "''" : shown}</Mono> : 'Not set here'],
            !!row?.managed && [
              'Managed',
              row.managed.by === 'spec'
                ? 'By Rook: CephCluster spec.cephConfig'
                : row.managed.by === 'secret'
                ? `By Rook, from the Secret ${row.managed.secret}`
                : 'Rook sets it itself',
            ],
          ]}
        />
        {rookDefault && <Typography sx={{ fontSize: 12.5, color: t.muted }}>{rookDefault.why}</Typography>}
        {row?.pending && <Notice tone="move">The CephCluster asks for this value; Rook has not set it in Ceph yet.</Notice>}
        {isModule ? (
          <Typography sx={{ fontSize: 13, color: t.muted }}>A manager module’s option: its module documents it (Ceph’s config help does not).</Typography>
        ) : loading && !help ? (
          <Loading compact label="Reading the option’s help…" />
        ) : missing ? (
          <Typography sx={{ fontSize: 13, color: t.muted }}>Ceph does not know this option (a typo, or an option of another release).</Typography>
        ) : error ? (
          <Notice tone="err">{error}</Notice>
        ) : help ? (
          <>
            <Box sx={{ borderTop: `1px solid ${t.rule}`, pt: 1.5 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{help.desc ? help.desc[0].toUpperCase() + help.desc.slice(1) : 'No description'}</Typography>
              {help.longDesc && <Typography sx={{ fontSize: 13, mt: 0.75, lineHeight: 1.55, color: t.text }}>{help.longDesc}</Typography>}
            </Box>
            <KV
              labelWidth={120}
              rows={[
                ['Type', help.type],
                ['Default', <Mono key="d">{help.default === '' ? "''" : help.default}</Mono>],
                help.daemonDefault !== '' && ['Daemon default', <Mono key="dd">{help.daemonDefault}</Mono>],
                help.min !== '' && ['Minimum', help.min],
                help.max !== '' && ['Maximum', help.max],
                help.enumValues.length > 0 && ['Allowed', <Mono key="e">{help.enumValues.join(', ')}</Mono>],
                ['Takes effect', help.runtime ? 'At once' : 'When the daemon restarts'],
                ['Level', help.level],
                help.services.length > 0 && ['Used by', help.services.join(', ')],
                help.tags.length > 0 && ['Tags', help.tags.join(', ')],
                help.seeAlso.length > 0 && [
                  'See also',
                  <Box key="s" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    {help.seeAlso.map(n => (
                      <Box
                        key={n}
                        component="button"
                        type="button"
                        onClick={() => onPick(n)}
                        sx={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '3px', '&:focus-visible': { outline: '2px solid', outlineOffset: 2 } }}
                      >
                        <Mono>{n}</Mono>
                      </Box>
                    ))}
                  </Box>,
                ],
              ]}
            />
          </>
        ) : null}
      </Box>
    </Panel>
  );
}

function History() {
  const t = useTokens();
  const log = useCephQuery('config.history', [mon('config log', { num: 30 })], { staleMs: 4000 });
  const changes = React.useMemo(() => parseConfigLog(out(log.data)), [log.data]);
  return (
    <Panel title="Recent changes" icon="mdi:history" dense>
      {!log.data ? (
        <Loading compact label="Reading config log…" />
      ) : changes.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: t.muted, p: 2 }}>No change recorded.</Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', maxHeight: 420, overflow: 'auto' }}>
          {changes.slice(0, 30).map(c => (
            <Box component="li" key={c.version} sx={{ px: 2, py: 1, borderBottom: `1px solid ${t.rule}`, fontSize: 13 }}>
              <Box sx={{ display: 'flex', gap: 1, color: t.muted, fontSize: 12.5 }}>
                <span>Version {c.version}</span>
                <Box sx={{ flex: 1 }} />
                <When at={c.time} />
              </Box>
              {c.changes.map((x, i) => (
                <Box key={i} sx={{ overflowWrap: 'anywhere' }}>
                  <Mono>{x.name}</Mono>{' '}
                  {x.value === undefined ? (
                    <Box component="span" sx={{ color: t.muted }}>
                      removed{x.previous !== undefined ? ` (was ${short(x.previous)})` : ''}
                    </Box>
                  ) : (
                    <Box component="span" sx={{ color: t.muted }}>
                      {x.previous !== undefined ? `${short(x.previous)} → ` : 'set to '}
                      <Mono>{short(x.value)}</Mono>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Panel>
  );
}

const short = (v: string) => (v.length > 60 ? `${v.slice(0, 57)}…` : v === '' ? "''" : v);
