/*
 * Ceph's live state, polled through the exec bridge while Cairn is open
 * and the tab is visible: one batch every few seconds (status, health,
 * OSD tree and map, usage, latency, pool rates, crashes, progress, PGs),
 * plus slower facts once a minute (OSD metadata, quorum, versions, mgr,
 * CRUSH rules, autoscaler). Each poll also feeds the time series used by
 * the charts.
 *
 * Views read `useCeph()`; view-specific commands (RBD images, config,
 * logs…) go through `useCephQuery()`, cached per key, or `runCeph()`.
 */

import React from 'react';
import { BridgeResult, resultError } from '../model/exec';
import { SeriesStore } from '../model/history';
import {
  buildOsdTree,
  parseAutoscale,
  parseCrashes,
  parseCrushRules,
  parseDf,
  parseHealth,
  parseHealthHistory,
  parseMgr,
  parseOsdMap,
  parseOsdMetadata,
  parsePgBrief,
  parsePools,
  parsePoolStats,
  parseProgress,
  parseQuorum,
  parseStatus,
  parseVersions,
  withHistory,
} from '../model/parse';
import {
  AutoscaleStatus,
  ClusterStatus,
  CrashEntry,
  CrushBucket,
  CrushHost,
  CrushRule,
  Health,
  HealthHistoryEntry,
  MgrInfo,
  Osd,
  OsdMapInfo,
  OsdMeta,
  PgBrief,
  Pool,
  ProgressEvent,
  Quorum,
  Versions,
} from '../model/types';
import { useSettings } from '../shell/settings';
import { bridgeFor, BridgeState, cephBatch, CephError, CephQuery, mgr, mon } from './bridge';
import { currentCluster } from './client';
import { useKube } from './kube';

export type CephPhase = 'checking' | 'ready' | 'forbidden' | 'unavailable' | 'nocluster';

export interface CephCore {
  status: ClusterStatus | null;
  /** Health detail with first/last seen. */
  health: Health | null;
  healthHistory: HealthHistoryEntry[];
  osdMap: OsdMapInfo | null;
  osds: Osd[];
  hosts: CrushHost[];
  buckets: CrushBucket[];
  roots: number[];
  df: ReturnType<typeof parseDf> | null;
  pools: Pool[];
  crashes: CrashEntry[];
  progress: { events: ProgressEvent[]; completed: ProgressEvent[] };
  pgs: PgBrief[];
  // slower facts
  osdMeta: Map<number, OsdMeta>;
  quorum: Quorum | null;
  versions: Versions | null;
  mgr: MgrInfo | null;
  rules: CrushRule[];
  autoscale: AutoscaleStatus[];
  balancer: any;
}

export interface CephData {
  phase: CephPhase;
  /** Why Ceph's live state is not available (forbidden/unavailable). */
  reason: string;
  bridge: BridgeState | null;
  /** Namespace of the CephCluster. */
  ns: string;
  core: CephCore;
  /** Last successful poll (ms). */
  updatedAt: number | null;
  /** The last poll failed (the data shown is from updatedAt). */
  error: string | null;
  series: SeriesStore;
  /** Poll now (after an operation). */
  refresh: () => void;
}

const FAST: Record<string, CephQuery> = {
  status: mon('status'),
  health: mon('health', { detail: 'detail' }),
  dfTree: mon('osd df', { output_method: 'tree' }),
  osdDump: mon('osd dump'),
  df: mon('df', { detail: 'detail' }),
  perf: mon('osd perf'),
  poolStats: mgr('osd pool stats'),
  crashes: mgr('crash ls'),
  history: mgr('healthcheck history ls'),
  progress: mgr('progress json'),
};

const SLOW: Record<string, CephQuery> = {
  meta: mon('osd metadata'),
  quorum: mon('quorum_status'),
  versions: mon('versions'),
  mgrDump: { ...mon('mgr dump'), keys: ['active_name', 'standbys', 'modules', 'services', 'available', 'active_change', 'always_on_modules'] },
  rules: mon('osd crush rule dump'),
  autoscale: mgr('osd pool autoscale-status'),
  balancer: mgr('balancer status'),
};

const PGS: CephQuery = mgr('pg dump', { dumpcontents: ['pgs_brief'] });
/** Above this many PGs the PG list is refreshed with the slow facts only. */
const PG_FAST_LIMIT = 4096;
const SLOW_EVERY_MS = 60000;

const seriesByCluster = new Map<string, SeriesStore>();
function seriesFor(key: string): SeriesStore {
  let s = seriesByCluster.get(key);
  if (!s) {
    s = new SeriesStore(360);
    seriesByCluster.set(key, s);
  }
  return s;
}

const EMPTY_CORE: CephCore = {
  status: null,
  health: null,
  healthHistory: [],
  osdMap: null,
  osds: [],
  hosts: [],
  buckets: [],
  roots: [],
  df: null,
  pools: [],
  crashes: [],
  progress: { events: [], completed: [] },
  pgs: [],
  osdMeta: new Map(),
  quorum: null,
  versions: null,
  mgr: null,
  rules: [],
  autoscale: [],
  balancer: null,
};

type Raw = Record<string, BridgeResult | undefined>;

const ok = (r?: BridgeResult) => (r && r.r === 0 ? r.out : undefined);

function assemble(raw: Raw, prev: CephCore): CephCore {
  const g = (k: string) => ok(raw[k]);
  const status = g('status') ? parseStatus(g('status')) : prev.status;
  const history = g('history') ? parseHealthHistory(g('history')) : prev.healthHistory;
  const health = g('health') ? withHistory(parseHealth(g('health')), history) : prev.health;
  const osdMeta = g('meta') ? parseOsdMetadata(g('meta')) : prev.osdMeta;
  const osdMap = g('osdDump') ? parseOsdMap(g('osdDump')) : prev.osdMap;
  const tree = g('dfTree') ? buildOsdTree(g('dfTree'), g('osdDump'), g('perf'), osdMeta) : null;
  const df = g('df') ? parseDf(g('df')) : prev.df;
  const rules = g('rules') ? parseCrushRules(g('rules')) : prev.rules;
  const stats = g('poolStats') ? parsePoolStats(g('poolStats')) : null;
  let pools = osdMap ? parsePools(osdMap.pools, df?.pools, rules, osdMap.ecProfiles) : prev.pools;
  if (stats) pools = pools.map(p => ({ ...p, io: stats.get(p.id)?.io, recovering: stats.get(p.id)?.recovering }));
  else pools = pools.map(p => ({ ...p, io: prev.pools.find(x => x.id === p.id)?.io }));
  return {
    status,
    health,
    healthHistory: history,
    osdMap,
    osds: tree?.osds ?? prev.osds,
    hosts: tree?.hosts ?? prev.hosts,
    buckets: tree?.buckets ?? prev.buckets,
    roots: tree?.roots ?? prev.roots,
    df,
    pools,
    crashes: g('crashes') ? parseCrashes(g('crashes')) : prev.crashes,
    progress: g('progress') ? parseProgress(g('progress')) : prev.progress,
    pgs: g('pgs') ? parsePgBrief(g('pgs')) : prev.pgs,
    osdMeta,
    quorum: g('quorum') ? parseQuorum(g('quorum')) : prev.quorum,
    versions: g('versions') ? parseVersions(g('versions')) : prev.versions,
    mgr: g('mgrDump') ? parseMgr(g('mgrDump')) : prev.mgr,
    rules,
    autoscale: g('autoscale') ? parseAutoscale(g('autoscale')) : prev.autoscale,
    balancer: g('balancer') ?? prev.balancer,
  };
}

function feedSeries(s: SeriesStore, c: CephCore, t: number) {
  const v: Record<string, number | undefined> = {};
  if (c.status) {
    v['io.readBps'] = c.status.io.readBps;
    v['io.writeBps'] = c.status.io.writeBps;
    v['io.readOps'] = c.status.io.readOps;
    v['io.writeOps'] = c.status.io.writeOps;
    v['recovery.bps'] = c.status.recovery.bytesPerSec;
    v['recovery.objs'] = c.status.recovery.objectsPerSec;
    v['raw.used'] = c.status.usedBytes;
    v['pg.notClean'] = c.status.pg.byState.filter(p => p.state !== 'active+clean').reduce((n, p) => n + p.count, 0);
  }
  for (const p of c.pools) {
    if (!p.io) continue;
    v[`pool.${p.id}.readBps`] = p.io.readBps;
    v[`pool.${p.id}.writeBps`] = p.io.writeBps;
    v[`pool.${p.id}.readOps`] = p.io.readOps;
    v[`pool.${p.id}.writeOps`] = p.io.writeOps;
    if (p.usage) v[`pool.${p.id}.stored`] = p.usage.stored;
  }
  const lat = c.osds.filter(o => o.commitMs !== undefined);
  for (const o of lat) {
    v[`osd.${o.id}.commitMs`] = o.commitMs;
    v[`osd.${o.id}.applyMs`] = o.applyMs;
  }
  if (lat.length) {
    v['lat.avgCommitMs'] = lat.reduce((n, o) => n + (o.commitMs ?? 0), 0) / lat.length;
    v['lat.maxCommitMs'] = Math.max(...lat.map(o => o.commitMs ?? 0));
    v['lat.avgApplyMs'] = lat.reduce((n, o) => n + (o.applyMs ?? 0), 0) / lat.length;
  }
  s.pushAll(t, v);
}

const Ctx = React.createContext<CephData | null>(null);

export function useCeph(): CephData {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useCeph outside CephProvider');
  return v;
}

export function CephProvider({ children }: { children: React.ReactNode }) {
  const kube = useKube();
  const [settings] = useSettings();
  const cluster = currentCluster();
  const ns = kube.ns;
  const hasCluster = !!kube.cephCluster;
  const [bridge, setBridge] = React.useState<BridgeState | null>(null);
  const [core, setCore] = React.useState<CephCore>(EMPTY_CORE);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const series = seriesFor(`${cluster}|${ns}`);
  const kick = React.useRef<() => void>(() => undefined);

  React.useEffect(() => {
    setCore(EMPTY_CORE);
    setUpdatedAt(null);
    setError(null);
    setBridge(null);
    if (!hasCluster) return;
    let alive = true;
    let timer: number | undefined;
    let lastSlow = 0;
    let prevCore = EMPTY_CORE;
    let inFlight = false;
    const period = Math.max(5, settings.refreshSec) * 1000;

    const poll = async (forceSlow = false) => {
      if (!alive || inFlight) return;
      inFlight = true;
      window.clearTimeout(timer);
      try {
        const st = await bridgeFor(ns, settings.bridge);
        if (!alive) return;
        setBridge(st);
        if (st.status !== 'ready') return;
        const slowDue = forceSlow || Date.now() - lastSlow > SLOW_EVERY_MS;
        const pgFast = (prevCore.status?.pg.total ?? 0) <= PG_FAST_LIMIT;
        const keys = [...Object.keys(FAST), ...(slowDue ? Object.keys(SLOW) : []), ...(slowDue || pgFast ? ['pgs'] : [])];
        const cmds = keys.map(k => FAST[k] ?? SLOW[k] ?? PGS);
        const res = await cephBatch(ns, cmds, { prefer: settings.bridge });
        if (!alive) return;
        const raw: Raw = {};
        keys.forEach((k, i) => (raw[k] = res[i]));
        if (raw.status && raw.status.r !== 0) throw new CephError(resultError(raw.status), raw.status.r);
        if (slowDue) lastSlow = Date.now();
        prevCore = assemble(raw, prevCore);
        const t = Date.now();
        feedSeries(series, prevCore, t);
        setCore(prevCore);
        setUpdatedAt(t);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message || String(e));
      } finally {
        inFlight = false;
        if (alive) timer = window.setTimeout(tick, period);
      }
    };
    const tick = () => {
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(tick, period);
        return;
      }
      poll();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    kick.current = () => {
      // After an operation: give Ceph a moment to apply it, then poll.
      window.setTimeout(() => poll(true), 1200);
    };
    document.addEventListener('visibilitychange', onVisible);
    poll(true);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, ns, hasCluster, settings.bridge, settings.refreshSec]);

  const refresh = React.useCallback(() => kick.current(), []);
  const phase: CephPhase = !kube.cephClusters.loaded
    ? 'checking'
    : !hasCluster
    ? 'nocluster'
    : !bridge
    ? 'checking'
    : bridge.status === 'ready'
    ? 'ready'
    : bridge.status;
  const reason = bridge && bridge.status !== 'ready' ? bridge.reason : '';
  const value = React.useMemo<CephData>(
    () => ({ phase, reason, bridge, ns, core, updatedAt, error, series, refresh }),
    [phase, reason, bridge, ns, core, updatedAt, error, series, refresh]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------- view-level queries */

interface Entry {
  data: BridgeResult[] | null;
  error: string | null;
  at: number;
  p: Promise<void> | null;
  listeners: Set<() => void>;
  /** The latest mounted fetcher, so invalidation can refetch at once. */
  fetcher?: () => Promise<void>;
}

const queryCache = new Map<string, Entry>();

function entry(key: string): Entry {
  let e = queryCache.get(key);
  if (!e) {
    e = { data: null, error: null, at: 0, p: null, listeners: new Set() };
    queryCache.set(key, e);
  }
  return e;
}

/**
 * Runs `cmds` (one batch) for a view, cached under `key` and shared by
 * every component asking for the same key. Refetches every `intervalMs`
 * while mounted (0 = only on mount/refresh), when older than `staleMs`.
 */
export function useCephQuery(
  key: string,
  cmds: CephQuery[] | null,
  opts: { intervalMs?: number; staleMs?: number } = {}
): { data: BridgeResult[] | null; error: string | null; loading: boolean; at: number; refresh: () => Promise<void> } {
  const { ns, phase } = useCeph();
  const fullKey = `${currentCluster()}|${ns}|${key}`;
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  const cmdSig = cmds ? JSON.stringify(cmds) : '';
  const fetchNow = React.useCallback(async () => {
    if (!cmds || phase !== 'ready') return;
    const e = entry(fullKey);
    if (e.p) return e.p;
    e.p = cephBatch(ns, cmds)
      .then(res => {
        e.data = res;
        e.error = null;
        e.at = Date.now();
      })
      .catch(err => {
        e.error = (err as Error).message || String(err);
      })
      .finally(() => {
        e.p = null;
        e.listeners.forEach(l => l());
      });
    e.listeners.forEach(l => l());
    return e.p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, cmdSig, phase, ns]);

  React.useEffect(() => {
    const e = entry(fullKey);
    e.listeners.add(force);
    e.fetcher = fetchNow;
    const stale = opts.staleMs ?? 5000;
    if (!e.data || Date.now() - e.at > stale) fetchNow();
    let id: number | undefined;
    if (opts.intervalMs) id = window.setInterval(() => document.visibilityState === 'visible' && fetchNow(), opts.intervalMs);
    return () => {
      e.listeners.delete(force);
      if (id) window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, fetchNow, opts.intervalMs]);

  const e = entry(fullKey);
  return { data: e.data, error: e.error, loading: !!e.p || (!e.data && !e.error && phase === 'ready'), at: e.at, refresh: fetchNow };
}

/** Drops cached view queries whose key starts with `prefix` (after an operation changed them). */
export function invalidateCephQueries(prefix = '') {
  for (const [k, e] of queryCache.entries()) {
    if (k.split('|').slice(2).join('|').startsWith(prefix)) {
      e.at = 0;
      if (e.listeners.size && e.fetcher) e.fetcher();
    }
  }
}

/** The first result's output when it succeeded (typed helper for views). */
export function out<T = any>(data: BridgeResult[] | null, i = 0): T | undefined {
  const r = data?.[i];
  return r && r.r === 0 ? (r.out as T) : undefined;
}

/** The error of result i, if it failed. */
export function outError(data: BridgeResult[] | null, i = 0): string | null {
  const r = data?.[i];
  return r && r.r !== 0 ? resultError(r) : null;
}

/**
 * Runs one Ceph command for an operation and returns Ceph's status line;
 * throws with Ceph's message when it fails. Use inside runOp().
 */
export async function runCeph(ns: string, q: CephQuery, timeoutMs?: number): Promise<string> {
  const [res] = await cephBatch(ns, [q], { timeoutMs });
  if (!res) throw new CephError('No answer from Ceph');
  if (res.r !== 0) throw new CephError(resultError(res), res.r);
  const msg = (res.err || '').trim();
  return msg || (typeof res.out === 'string' ? res.out.trim() : '') || 'Done';
}
