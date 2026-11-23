/*
 * Ceph's central configuration ("config dump", "config help", "config
 * log") and its logs ("log last"), for the Configuration view: grouping
 * and search, which settings Rook manages (CephCluster spec.cephConfig and
 * cephConfigFromSecret, and the defaults Rook sets itself), values that may
 * hold secrets (hidden), the exact command a change runs, and the filters of
 * the cluster and audit logs.
 */

import { cephTime } from './format';
import { ConfigEntry, LogEntry, Obj } from './types';

/* ------------------------------------------------------------- entries */

/** The "who" of an entry, as config set/rm take it: "osd", "osd.3", "osd/host:node1". */
export function whoOf(e: Pick<ConfigEntry, 'section' | 'mask'>): string {
  return e.mask ? `${e.section}/${e.mask}` : e.section;
}

/** Option names are written with spaces, dashes or underscores; Ceph keeps underscores. */
export function normName(n: string): string {
  return n.trim().replace(/[\s-]+/g, '_').toLowerCase();
}

const SECTION_ORDER = ['global', 'mon', 'mgr', 'osd', 'mds', 'client'];

function sectionRank(s: string): number {
  const base = s.split(/[./]/)[0];
  const i = SECTION_ORDER.indexOf(base);
  return i < 0 ? SECTION_ORDER.length : i;
}

/** Sections in Ceph's order (global, mon, mgr, osd, mds, client, then the rest), each with its entries by name. */
export function groupConfig<T extends ConfigEntry>(entries: T[]): { who: string; entries: T[] }[] {
  const m = new Map<string, T[]>();
  for (const e of entries) {
    const k = whoOf(e);
    m.set(k, [...(m.get(k) ?? []), e]);
  }
  return [...m.entries()]
    .map(([who, list]) => ({ who, entries: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => sectionRank(a.who) - sectionRank(b.who) || a.who.localeCompare(b.who, undefined, { numeric: true }));
}

/** Words match the name, the who, or the value (all words must match). */
export function searchConfig<T extends ConfigEntry>(entries: T[], q: string): T[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter(e => {
    const hay = `${e.name} ${normName(e.name)} ${whoOf(e)} ${sensitive(e.name) ? '' : e.value}`.toLowerCase();
    return words.every(w => hay.includes(w) || hay.includes(normName(w)));
  });
}

/* ------------------------------------------------------------- secrets */

const SENSITIVE_NAME = /(password|passwd|secret|token|credential|private|_key$|\/key$|access_key|ssl_key|jwt|multicluster_config)/i;

/** Does the option's value probably hold a secret (dashboard tokens, RGW keys, passwords)? */
export function sensitive(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

export const HIDDEN = 'Hidden: may hold a secret';

/** The value to show: secrets hidden, JSON values with token/password/key fields blanked. */
export function displayValue(name: string, value: string): string {
  if (sensitive(name)) return value ? HIDDEN : '';
  if (/^[[{]/.test(value.trim())) {
    try {
      return JSON.stringify(redactJson(JSON.parse(value)));
    } catch {
      return value;
    }
  }
  return value;
}

function redactJson(o: any): any {
  if (Array.isArray(o)) return o.map(redactJson);
  if (o && typeof o === 'object') {
    const n: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) n[k] = SENSITIVE_NAME.test(k) || k === 'key' ? (v ? '…' : v) : redactJson(v);
    return n;
  }
  return o;
}

/* --------------------------------------------------------- Rook-managed */

export type ManagedBy =
  /** CephCluster spec.cephConfig: edit it there, Rook applies it. */
  | { by: 'spec'; who: string; name: string; value: string }
  /** CephCluster spec.cephConfigFromSecret: the value comes from a Secret. */
  | { by: 'secret'; who: string; name: string; secret: string }
  /** Rook sets it itself on every reconcile (its defaults). */
  | { by: 'rook-default'; who: string; name: string };

/** Options Rook sets in the config database itself (pkg/operator/ceph/config): changing them by hand may be undone. */
export const ROOK_DEFAULTS: { who: string; name: string; why: string }[] = [
  { who: 'global', name: 'mon_allow_pool_delete', why: 'Rook deletes pools when their CephBlockPool is deleted.' },
  { who: 'global', name: 'mon_cluster_log_file', why: 'Rook sends the cluster log to the pods’ output, not to a file.' },
  { who: 'global', name: 'mon_allow_pool_size_one', why: 'Rook allows size-1 pools when a CephBlockPool asks for one.' },
  { who: 'global', name: 'log_to_file', why: 'Set from the CephCluster logCollector settings.' },
  { who: 'mon', name: 'auth_allow_insecure_global_id_reclaim', why: 'Rook turns insecure global_id reclaim off once every daemon is updated.' },
];

/** Every option the CephCluster asks Rook to manage, keyed "who|name". */
export function rookManaged(cluster: Obj | null | undefined): Map<string, ManagedBy> {
  const m = new Map<string, ManagedBy>();
  for (const d of ROOK_DEFAULTS) m.set(`${d.who}|${d.name}`, { by: 'rook-default', who: d.who, name: d.name });
  const spec = cluster?.spec ?? {};
  for (const [who, opts] of Object.entries<any>(spec.cephConfig ?? {})) {
    for (const [name, value] of Object.entries<any>(opts ?? {})) {
      m.set(`${who}|${normName(name)}`, { by: 'spec', who, name, value: String(value) });
    }
  }
  for (const [who, opts] of Object.entries<any>(spec.cephConfigFromSecret ?? {})) {
    for (const [name, ref] of Object.entries<any>(opts ?? {})) {
      m.set(`${who}|${normName(name)}`, { by: 'secret', who, name, secret: `${ref?.name ?? '?'}/${ref?.key ?? '?'}` });
    }
  }
  return m;
}

export function managedBy(map: Map<string, ManagedBy>, who: string, name: string): ManagedBy | undefined {
  return map.get(`${who}|${normName(name)}`);
}

/** The CephCluster with spec.cephConfig[who][name] set to value (null removes it). */
export function withCephConfig(cluster: Obj, who: string, name: string, value: string | null): Obj {
  const c: Obj = JSON.parse(JSON.stringify(cluster));
  c.spec = c.spec ?? {};
  const all: Record<string, Record<string, string>> = { ...(c.spec.cephConfig ?? {}) };
  const section: Record<string, string> = { ...(all[who] ?? {}) };
  // Keep the spelling the spec already uses for this option.
  const existing = Object.keys(section).find(k => normName(k) === normName(name));
  if (existing) delete section[existing];
  if (value !== null) section[existing ?? name] = value;
  if (Object.keys(section).length) all[who] = section;
  else delete all[who];
  if (Object.keys(all).length) c.spec.cephConfig = all;
  else delete c.spec.cephConfig;
  return c;
}

/* ------------------------------------------------------- commands, who */

/** The command line a change runs, for the confirmation ("ceph config set osd osd_max_backfills 2"). */
export function configCommandText(op: 'set' | 'rm', who: string, name: string, value?: string): string {
  const q = (s: string) => (s === '' || /[\s"'$`\\;&|<>()*?#]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s);
  return op === 'set' ? `ceph config set ${q(who)} ${q(name)} ${q(value ?? '')}` : `ceph config rm ${q(who)} ${q(name)}`;
}

const WHO_TYPES = ['global', 'mon', 'mgr', 'osd', 'mds', 'client'];

/** Is it a who Ceph takes? global, a type, a daemon (osd.3, client.rgw.x), optionally /host:… or /class:…. Returns the problem, or null. */
export function whoProblem(who: string): string | null {
  const w = who.trim();
  if (!w) return 'Say who it applies to: global, a daemon type (osd) or one daemon (osd.3).';
  const [base, mask, extra] = w.split('/');
  if (extra !== undefined) return 'Only one mask: osd/host:node1 or osd/class:ssd.';
  const type = base.split('.')[0];
  if (!WHO_TYPES.includes(type)) return `Starts with ${WHO_TYPES.join(', ')}.`;
  if (type === 'global' && base !== 'global') return 'global has no daemon name.';
  if (!/^[a-z]+(\.[A-Za-z0-9_.*-]+)?$/.test(base)) return 'A daemon name has letters, digits, ".", "-" and "_".';
  if (mask !== undefined && !/^(host|class|rack|root|datacenter|zone|region|chassis|row|room|pod|pdu):[A-Za-z0-9_.-]+$/.test(mask))
    return 'A mask is host:<name>, class:<device class> or another CRUSH type.';
  return null;
}

/* ---------------------------------------------------------------- help */

export interface ConfigHelp {
  name: string;
  type: string;
  level: string;
  desc: string;
  longDesc: string;
  default: string;
  daemonDefault: string;
  min: string;
  max: string;
  enumValues: string[];
  services: string[];
  seeAlso: string[];
  tags: string[];
  runtime: boolean;
  flags: string[];
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function parseConfigHelp(raw: any): ConfigHelp | null {
  if (!raw || typeof raw !== 'object' || !raw.name) return null;
  const a = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    name: s(raw.name),
    type: s(raw.type),
    level: s(raw.level),
    desc: s(raw.desc),
    longDesc: s(raw.long_desc),
    default: s(raw.default),
    daemonDefault: s(raw.daemon_default),
    min: s(raw.min),
    max: s(raw.max),
    enumValues: a(raw.enum_values),
    services: a(raw.services),
    seeAlso: a(raw.see_also),
    tags: a(raw.tags),
    runtime: !!raw.can_update_at_runtime,
    flags: a(raw.flags),
  };
}

/** Does the value fit the option's type and range? Returns the problem, or null. */
export function valueProblem(v: string, h: ConfigHelp | null): string | null {
  if (!h) return null;
  const x = v.trim();
  if (h.enumValues.length && !h.enumValues.includes(x)) return `One of ${h.enumValues.join(', ')}.`;
  switch (h.type) {
    case 'bool':
      return /^(true|false|yes|no|on|off|1|0)$/i.test(x) ? null : 'true or false.';
    case 'uint':
    case 'int':
    case 'size':
    case 'secs':
    case 'millisecs':
    case 'float': {
      if (h.type === 'size' && /^\d+(\.\d+)?\s*[KMGTPE]i?B?$/i.test(x)) return null;
      if (h.type === 'secs' && /^\d+\s*[smhdw]$/i.test(x)) return null;
      const n = Number(x);
      if (x === '' || !isFinite(n)) return `A number${h.type === 'size' ? ' or a size (4G, 512M)' : ''}.`;
      if (h.type === 'uint' && n < 0) return 'Zero or more.';
      if ((h.type === 'uint' || h.type === 'int') && !Number.isInteger(n)) return 'A whole number.';
      if (h.min !== '' && n < Number(h.min)) return `At least ${h.min}.`;
      if (h.max !== '' && n > Number(h.max)) return `At most ${h.max}.`;
      return null;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------- history */

export interface ConfigChange {
  version: number;
  time: number | null;
  name: string;
  changes: { name: string; previous?: string; value?: string }[];
}

/** "config log": newest first; values that may be secrets hidden. */
export function parseConfigLog(raw: any): ConfigChange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v: any) => ({
      version: Number(v.version) || 0,
      time: cephTime(v.timestamp),
      name: s(v.name),
      changes: (Array.isArray(v.changes) ? v.changes : []).map((c: any) => {
        const n = s(c.name);
        const short = n.replace(/^[^/]+\//, '');
        return {
          name: n,
          previous: c.previous_value === undefined ? undefined : displayValue(short, s(c.previous_value)),
          value: c.new_value === undefined ? undefined : displayValue(short, s(c.new_value)),
        };
      }),
    }))
    .sort((a, b) => b.version - a.version);
}

/* ---------------------------------------------------------------- logs */

export type Priority = 'DBG' | 'INF' | 'SEC' | 'WRN' | 'ERR';

export const PRIORITIES: { id: Priority; word: string; tone: 'idle' | 'ok' | 'move' | 'warn' | 'err' }[] = [
  { id: 'DBG', word: 'Debug', tone: 'idle' },
  { id: 'INF', word: 'Info', tone: 'ok' },
  { id: 'SEC', word: 'Security', tone: 'move' },
  { id: 'WRN', word: 'Warning', tone: 'warn' },
  { id: 'ERR', word: 'Error', tone: 'err' },
];

export function priorityOf(p: string): (typeof PRIORITIES)[number] {
  const x = p.replace(/[[\]]/g, '').toUpperCase();
  return PRIORITIES.find(q => q.id === x) ?? { id: x as Priority, word: x || 'Unknown', tone: 'idle' };
}

/** The level asked of "log last": entries at this priority and above. */
export type LogLevel = 'debug' | 'info' | 'sec' | 'warn' | 'error';

export function filterLog(entries: LogEntry[], f: { priorities?: Priority[]; q?: string }): LogEntry[] {
  const words = (f.q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const pri = f.priorities && f.priorities.length ? new Set(f.priorities) : null;
  return entries.filter(e => {
    if (pri && !pri.has(priorityOf(e.priority).id)) return false;
    if (!words.length) return true;
    const hay = `${e.who} ${e.message}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

export function countByPriority(entries: LogEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const p = priorityOf(e.priority).id;
    out[p] = (out[p] ?? 0) + 1;
  }
  return out;
}

export interface AuditInfo {
  /** "client.admin", "mgr.a". */
  entity: string;
  /** Address it came from. */
  from: string;
  /** The command's prefix ("osd pool set"), when the message carries one. */
  prefix: string;
  /** The other arguments, compact. */
  args: string;
  /** dispatch, finished, or another phase word. */
  phase: string;
}

/** Splits an audit message: from='…' entity='…' cmd=[{…}]: dispatch. */
export function parseAudit(message: string): AuditInfo {
  const entity = message.match(/entity='([^']*)'/)?.[1] ?? '';
  const from = message.match(/from='([^']*)'/)?.[1] ?? '';
  const phase = message.match(/:\s*(dispatch|finished|[a-z]+)\s*$/)?.[1] ?? '';
  let prefix = '';
  let args = '';
  // The monitor writes cmd={…} on dispatch and cmd='[{…}]' when finished.
  const m = message.match(/cmd='?(\[.*\]|\{.*\})'?\s*:\s*[a-z]+\s*$/) ?? message.match(/cmd='?(\[.*\]|\{.*\})/);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]);
      const cmd = Array.isArray(parsed) ? parsed[0] : parsed;
      if (cmd && typeof cmd === 'object') {
        prefix = s(cmd.prefix);
        args = Object.entries(cmd)
          .filter(([k]) => k !== 'prefix' && k !== 'format')
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' ');
      }
    } catch {
      prefix = m[1].match(/"prefix":\s*"([^"]*)"/)?.[1] ?? '';
    }
  }
  return { entity, from, prefix, args, phase };
}
