/*
 * Ceph's cluster log and audit log ("log last", the last 500 entries of a
 * channel at a level and above), refreshed every 10 seconds while shown;
 * filtered by priority and words. Audit entries are split into who ran
 * what (entity, command, phase).
 */

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import React from 'react';
import { mon } from '../../api/bridge';
import { out, outError, useCephQuery } from '../../api/ceph';
import { countByPriority, filterLog, LogLevel, parseAudit, PRIORITIES, Priority, priorityOf } from '../../model/config';
import { parseLog } from '../../model/parse';
import { LogEntry } from '../../model/types';
import { LiveGate,Loading } from '../../shell/Gate';
import { Column, DataTable } from '../../ui/DataTable';
import { Action, Empty, Mono, Notice, Panel, Toolbar } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { STATE, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { SearchField, SmallSelect } from '../kubernetes/parts';

const LEVELS: { value: LogLevel; label: string }[] = [
  { value: 'debug', label: 'Debug and above' },
  { value: 'info', label: 'Info and above' },
  { value: 'sec', label: 'Security and above' },
  { value: 'warn', label: 'Warnings and above' },
  { value: 'error', label: 'Errors only' },
];

const NUM = 500;

function time(t: number | null): string {
  if (!t) return '—';
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour12: false }) : d.toLocaleString([], { hour12: false });
}

export function LogTab({ channel }: { channel: 'cluster' | 'audit' }) {
  return (
    <LiveGate what={channel === 'audit' ? 'the audit log' : 'the cluster log'}>
      <Log channel={channel} />
    </LiveGate>
  );
}

function Log({ channel }: { channel: 'cluster' | 'audit' }) {
  const t = useTokens();
  const [level, setLevel] = React.useState<LogLevel>('info');
  const [auto, setAuto] = React.useState(true);
  const [q, setQ] = React.useState('');
  const [pri, setPri] = React.useState<Priority[]>([]);
  const query = useCephQuery(`config.log.${channel}.${level}`, [mon('log last', { num: NUM, level, channel })], { intervalMs: auto ? 10000 : 0, staleMs: 3000 });
  const entries = React.useMemo(() => parseLog(out(query.data) ?? []), [query.data]);
  const shown = React.useMemo(() => filterLog(entries, { priorities: pri, q }), [entries, pri, q]);
  const counts = countByPriority(entries);
  const err = outError(query.data) ?? query.error;
  const audit = channel === 'audit';

  const toggle = (p: Priority) => setPri(cur => (cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]));

  const cols: Column<LogEntry>[] = [
    { id: 'time', header: 'Time', cell: e => <span title={e.time ? new Date(e.time).toISOString() : ''}>{time(e.time)}</span>, sort: e => e.time ?? 0, width: 150 },
    { id: 'who', header: 'Daemon', cell: e => <Mono>{e.who}</Mono>, sort: e => e.who, width: 110 },
    {
      id: 'pri',
      header: 'Priority',
      cell: e => {
        const p = priorityOf(e.priority);
        return <StateLabel tone={p.tone} size="sm">{p.word}</StateLabel>;
      },
      sort: e => PRIORITIES.findIndex(p => p.id === priorityOf(e.priority).id),
      width: 110,
    },
  ];
  if (audit) {
    cols.push(
      { id: 'entity', header: 'Entity', cell: e => <Mono>{parseAudit(e.message).entity || '—'}</Mono>, sort: e => parseAudit(e.message).entity, width: 150 },
      {
        id: 'cmd',
        header: 'Command',
        cell: e => {
          const a = parseAudit(e.message);
          return a.prefix ? (
            <Box component="span" title={e.message} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
              <Mono>{a.prefix}</Mono>
              {a.args && (
                <Box component="span" sx={{ color: t.muted, ml: 1 }}>
                  <Mono muted>{a.args.length > 160 ? `${a.args.slice(0, 157)}…` : a.args}</Mono>
                </Box>
              )}
            </Box>
          ) : (
            <Box component="span" sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
              {e.message}
            </Box>
          );
        },
        width: 620,
      },
      { id: 'phase', header: 'Phase', cell: e => parseAudit(e.message).phase || '—', sort: e => parseAudit(e.message).phase, width: 90 },
      { id: 'from', header: 'From', cell: e => <Mono muted>{parseAudit(e.message).from || '—'}</Mono>, minWidth: 1500, width: 240 }
    );
  } else {
    cols.push({
      id: 'msg',
      header: 'Message',
      cell: e => (
        <Box component="span" sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          {e.message}
        </Box>
      ),
      width: 900,
    });
  }

  return (
    <>
      <Panel dense>
        <Toolbar sx={{ gap: 1, py: 1 }}>
          <SmallSelect<LogLevel> label="Ceph sends" value={level} onChange={v => setLevel(v)} options={LEVELS} width={190} name={`log-level-${channel}`} />
          <Box role="group" aria-label="Show priorities" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {PRIORITIES.filter(p => counts[p.id] || pri.includes(p.id)).map(p => {
              const on = pri.includes(p.id);
              return (
                <Box
                  key={p.id}
                  component="button"
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(p.id)}
                  sx={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.75,
                    px: 1,
                    height: 28,
                    borderRadius: `${t.radius.small}px`,
                    border: `1px solid ${on ? STATE[p.tone] : t.rule}`,
                    background: on ? t.tint[p.tone] : 'transparent',
                    fontSize: 13,
                    ...tabular,
                    '&:focus-visible': { outline: `2px solid ${t.meterUsed}`, outlineOffset: 2 },
                  }}
                >
                  <StateLabel tone={p.tone} size="sm">
                    {p.word}
                  </StateLabel>
                  <Box component="span" sx={{ color: t.muted }}>
                    {counts[p.id] ?? 0}
                  </Box>
                </Box>
              );
            })}
          </Box>
          <SearchField value={q} onChange={setQ} placeholder={audit ? 'Search entities, commands' : 'Search daemons, messages'} width={260} name={`log-search-${channel}`} />
          <Box sx={{ flex: 1 }} />
          <FormControlLabel
            control={<Switch size="small" checked={auto} onChange={e => setAuto(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13.5 }}>Refresh every 10 s</Typography>}
          />
          <Action icon="mdi:refresh" onClick={() => query.refresh()} disabled={query.loading}>
            Refresh
          </Action>
        </Toolbar>
        {err && (
          <Box sx={{ p: 1.5 }}>
            <Notice tone="err" title="Ceph did not return the log">
              {err}
            </Notice>
          </Box>
        )}
        {!query.data && !err ? (
          <Loading label="Reading the log…" />
        ) : (
          <>
            <Typography sx={{ fontSize: 12.5, color: t.muted, px: 1.5, py: 0.75, borderBottom: `1px solid ${t.rule}`, ...tabular }}>
              {shown.length === entries.length ? `${entries.length} entries` : `${shown.length} of ${entries.length} entries`}
              {entries.length >= NUM ? `: the last ${NUM} Ceph keeps at this level` : ''}, newest first
              {query.at ? `, read at ${new Date(query.at).toLocaleTimeString([], { hour12: false })}` : ''}.
            </Typography>
            <DataTable
              label={audit ? 'Audit log' : 'Cluster log'}
              rows={shown}
              columns={cols}
              rowKey={e => `${e.seq}-${e.time}-${e.who}`}
              initialSort={{ id: 'time', dir: 'desc' }}
              empty={
                entries.length ? (
                  <Empty icon="mdi:filter-off-outline" title="No entry matches">
                    Clear the search or the priority filter.
                  </Empty>
                ) : (
                  <Empty
                    icon="mdi:text-box-search-outline"
                    title={`No ${LEVELS.find(l => l.value === level)?.label.toLowerCase().replace(' and above', '') ?? ''} entries`}
                    action={
                      level !== 'debug' ? (
                        <Action icon="mdi:text-box-plus-outline" onClick={() => setLevel('debug')}>
                          Show debug entries
                        </Action>
                      ) : undefined
                    }
                  >
                    {audit
                      ? 'Ceph has recorded no command at this level.'
                      : 'The cluster log is quiet at this level: nothing went wrong lately. Debug entries show scrubs and placement-group map updates.'}
                  </Empty>
                )
              }
            />
          </>
        )}
      </Panel>
    </>
  );
}
