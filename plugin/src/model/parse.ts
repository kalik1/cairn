/*
 * Parsers for Ceph's JSON answers (format=json). Each takes the raw
 * output of one command and returns the typed shape from ./types,
 * tolerating missing fields.
 */

import { cephTime } from './format';
import {
  AutoscaleStatus,
  ClusterStatus,
  ConfigEntry,
  CrashEntry,
  CrushBucket,
  CrushHost,
  CrushRule,
  Health,
  HealthCheck,
  HealthHistoryEntry,
  LogEntry,
  MgrInfo,
  Osd,
  OsdMapInfo,
  OsdMeta,
  PgBrief,
  Pool,
  PoolUsage,
  Quorum,
  Severity,
  Versions,
} from './types';

export const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && isFinite(n) ? n : d;
};
export const str = (v: unknown, d = ''): string => (v === null || v === undefined ? d : String(v));
export const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : {});

const SEVERITIES: Severity[] = ['HEALTH_OK', 'HEALTH_WARN', 'HEALTH_ERR'];
export const severity = (v: unknown): Severity => (SEVERITIES.includes(v as Severity) ? (v as Severity) : 'HEALTH_WARN');
export const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

/** Cluster flags Ceph sets for itself; not something an admin toggles. */
export const INTERNAL_FLAGS = new Set(['sortbitwise', 'recovery_deletes', 'purged_snapdirs', 'pglog_hardlimit', 'require_jewel_osds', 'require_kraken_osds']);

/* --------------------------------------------------------------- health */

/** "health detail" (or the health part of "status"). */
export function parseHealth(raw: any): Health {
  const h = obj(raw);
  const checks: HealthCheck[] = Object.entries(obj(h.checks)).map(([code, c]: [string, any]) => ({
    code,
    severity: severity(c?.severity),
    summary: str(c?.summary?.message, code),
    count: num(c?.summary?.count, 1),
    details: arr(c?.detail).map((d: any) => str(d?.message)).filter(Boolean),
    muted: !!c?.muted,
  }));
  checks.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.code.localeCompare(b.code));
  const mutes = arr(h.mutes).map((m: any) => ({
    code: str(m?.code),
    until: m?.ttl ? cephTime(m.ttl) : null,
    sticky: !!m?.sticky,
    summary: m?.summary ? str(m.summary) : undefined,
    count: m?.count !== undefined ? num(m.count) : undefined,
  }));
  return { status: h.status ? severity(h.status) : checks.length ? 'HEALTH_WARN' : 'HEALTH_OK', checks, mutes };
}

/** "healthcheck history ls" (mgr). */
export function parseHealthHistory(raw: any): HealthHistoryEntry[] {
  return Object.values(obj(raw))
    .map((e: any) => ({
      code: str(e?.name),
      severity: severity(e?.severity),
      firstSeen: cephTime(e?.first_seen),
      lastSeen: cephTime(e?.last_seen),
      count: num(e?.count),
      active: !!e?.active,
    }))
    .filter(e => e.code)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

/** Adds first/last seen from the history to the active checks. */
export function withHistory(h: Health, history: HealthHistoryEntry[]): Health {
  const by = new Map(history.map(e => [e.code, e]));
  return {
    ...h,
    checks: h.checks.map(c => ({ ...c, firstSeen: by.get(c.code)?.firstSeen ?? c.firstSeen, lastSeen: by.get(c.code)?.lastSeen ?? c.lastSeen })),
  };
}

/* --------------------------------------------------------------- status */

export function parseStatus(raw: any): ClusterStatus {
  const s = obj(raw);
  const pg = obj(s.pgmap);
  const osd = obj(s.osdmap?.osdmap ?? s.osdmap);
  const mgr = obj(s.mgrmap);
  const fs = obj(s.fsmap);
  const progress = Object.entries(obj(s.progress_events)).map(([id, e]: [string, any]) => ({
    id,
    message: str(e?.message),
    progress: Math.max(0, Math.min(1, num(e?.progress))),
  }));
  return {
    fsid: str(s.fsid),
    health: parseHealth(s.health),
    quorum: arr<string>(s.quorum_names).map(String),
    quorumAgeSec: num(s.quorum_age),
    monCount: num(s.monmap?.num_mons, arr(s.monmap?.mons).length),
    osd: {
      total: num(osd.num_osds),
      up: num(osd.num_up_osds),
      in: num(osd.num_in_osds),
      remappedPgs: num(osd.num_remapped_pgs),
      upSince: osd.osd_up_since ? cephTime(osd.osd_up_since) : null,
      inSince: osd.osd_in_since ? cephTime(osd.osd_in_since) : null,
    },
    pg: {
      total: num(pg.num_pgs),
      byState: arr(pg.pgs_by_state)
        .map((p: any) => ({ state: str(p?.state_name), count: num(p?.count) }))
        .sort((a, b) => b.count - a.count),
    },
    pools: num(pg.num_pools),
    objects: num(pg.num_objects),
    dataBytes: num(pg.data_bytes),
    usedBytes: num(pg.bytes_used),
    availBytes: num(pg.bytes_avail),
    totalBytes: num(pg.bytes_total),
    io: {
      readBps: num(pg.read_bytes_sec),
      writeBps: num(pg.write_bytes_sec),
      readOps: num(pg.read_op_per_sec),
      writeOps: num(pg.write_op_per_sec),
    },
    recovery: {
      bytesPerSec: num(pg.recovering_bytes_per_sec),
      objectsPerSec: num(pg.recovering_objects_per_sec),
      keysPerSec: num(pg.recovering_keys_per_sec),
      degradedObjects: num(pg.degraded_objects),
      degradedTotal: num(pg.degraded_total),
      degradedRatio: num(pg.degraded_ratio),
      misplacedObjects: num(pg.misplaced_objects),
      misplacedTotal: num(pg.misplaced_total),
      misplacedRatio: num(pg.misplaced_ratio),
      unfoundObjects: num(pg.unfound_objects),
    },
    progress,
    mgr: {
      available: !!mgr.available,
      standbys: num(mgr.num_standbys),
      modules: arr<string>(mgr.modules).map(String),
      services: obj(mgr.services),
    },
    fs: { up: arr(fs.by_rank).length, standby: num(fs['up:standby']), epoch: num(fs.epoch) },
  };
}

/** "progress json" (mgr): running and recently completed events. */
export function parseProgress(raw: any): { events: ClusterStatus['progress']; completed: ClusterStatus['progress'] } {
  const p = obj(raw);
  const map = (e: any, done: boolean) => ({
    id: str(e?.id),
    message: str(e?.message),
    progress: done ? 1 : Math.max(0, Math.min(1, num(e?.progress))),
    startedAt: cephTime(e?.started_at),
    finishedAt: done ? cephTime(e?.finished_at) : null,
    failed: !!e?.failed,
  });
  return { events: arr(p.events).map(e => map(e, false)), completed: arr(p.completed).map(e => map(e, true)) };
}

/* ----------------------------------------------------------------- OSDs */

const kvList = (s: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of str(s).split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
};

/** "osd metadata" (all OSDs). */
export function parseOsdMetadata(raw: any): Map<number, OsdMeta> {
  const out = new Map<number, OsdMeta>();
  for (const m of arr(raw)) {
    const id = num(m?.id, -1);
    if (id < 0) continue;
    out.set(id, {
      id,
      hostname: str(m.hostname),
      devices: str(m.devices).split(',').filter(Boolean),
      devicePaths: kvList(m.device_paths),
      deviceIds: kvList(m.device_ids),
      rotational: m.rotational === undefined ? null : str(m.rotational) === '1',
      bdevType: str(m.bluestore_bdev_type),
      bdevSize: num(m.bluestore_bdev_size),
      objectstore: str(m.osd_objectstore),
      version: str(m.ceph_version_short),
      kernel: str(m.kernel_version),
      distro: str(m.distro_description),
      podName: str(m.pod_name),
      podNamespace: str(m.pod_namespace),
      dedicatedDb: str(m.bluefs_dedicated_db) === '1',
      dedicatedWal: str(m.bluefs_dedicated_wal) === '1',
      memTotalKb: num(m.mem_total_kb),
    });
  }
  return out;
}

/** "osd dump". */
export function parseOsdMap(raw: any): OsdMapInfo {
  const d = obj(raw);
  const flags = str(d.flags)
    .split(',')
    .map(f => f.trim())
    .filter(f => f && !INTERNAL_FLAGS.has(f));
  const osdFlags: Record<number, string[]> = {};
  const groupFlags = (v: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const [k, f] of Object.entries(obj(v))) {
      const list = Array.isArray(f) ? f.map(String) : str(f).split(',').filter(Boolean);
      if (list.length) out[k] = list;
    }
    return out;
  };
  for (const o of arr(d.osds)) {
    const st = arr<string>(o?.state).filter(s => /^no(out|in|up|down)$/.test(s));
    if (st.length) osdFlags[num(o.osd)] = st;
  }
  return {
    epoch: num(d.epoch),
    flags,
    fullRatio: num(d.full_ratio, 0.95),
    backfillFullRatio: num(d.backfillfull_ratio, 0.9),
    nearFullRatio: num(d.nearfull_ratio, 0.85),
    requireOsdRelease: str(d.require_osd_release),
    requireMinCompatClient: str(d.require_min_compat_client),
    osdFlags,
    crushNodeFlags: groupFlags(d.crush_node_flags),
    deviceClassFlags: groupFlags(d.device_class_flags),
    pools: arr(d.pools),
    ecProfiles: obj(d.erasure_code_profiles),
    blocklistCount: Object.keys(obj(d.blocklist)).length,
  };
}

/**
 * "osd df tree" + "osd dump" + "osd perf" + metadata → OSDs, hosts and
 * every CRUSH bucket.
 */
export function buildOsdTree(
  dfTree: any,
  osdMap?: any,
  perf?: any,
  meta?: Map<number, OsdMeta>
): { osds: Osd[]; hosts: CrushHost[]; buckets: CrushBucket[]; roots: number[] } {
  const nodes = arr(obj(dfTree).nodes);
  const stray = arr(obj(dfTree).stray);
  const dump = new Map<number, any>(arr(obj(osdMap).osds).map((o: any) => [num(o.osd), o]));
  const perfBy = new Map<number, any>(
    arr(obj(perf).osdstats?.osd_perf_infos ?? obj(perf).osd_perf_infos).map((p: any) => [num(p.id), p.perf_stats])
  );
  const parentOf = new Map<number, number>();
  for (const n of nodes) for (const c of arr<number>(n.children)) parentOf.set(c, num(n.id));
  const byId = new Map<number, any>(nodes.map((n: any) => [num(n.id), n]));
  const hostOf = (id: number): string => {
    let p = parentOf.get(id);
    while (p !== undefined) {
      const b = byId.get(p);
      if (b?.type === 'host') return str(b.name);
      p = parentOf.get(p);
    }
    return '';
  };
  const osds: Osd[] = [];
  for (const n of [...nodes, ...stray]) {
    if (n?.type !== 'osd') continue;
    const id = num(n.id);
    const d = dump.get(id);
    const p = perfBy.get(id);
    const kb = (v: unknown) => num(v) * 1024;
    osds.push({
      id,
      name: str(n.name, `osd.${id}`),
      host: hostOf(id),
      deviceClass: str(n.device_class),
      crushWeight: num(n.crush_weight),
      reweight: num(n.reweight, d ? num(d.weight) : 1),
      primaryAffinity: num(d?.primary_affinity, num(n.primary_affinity, 1)),
      up: d ? num(d.up) === 1 : str(n.status) === 'up',
      in: d ? num(d.in) === 1 : num(n.reweight) > 0,
      status: str(n.status, d ? (num(d.up) ? 'up' : 'down') : 'unknown'),
      sizeBytes: kb(n.kb),
      usedBytes: kb(n.kb_used),
      availBytes: kb(n.kb_avail),
      dataBytes: kb(n.kb_used_data),
      omapBytes: kb(n.kb_used_omap),
      metaBytes: kb(n.kb_used_meta),
      utilization: num(n.utilization),
      variance: num(n.var),
      pgs: num(n.pgs),
      commitMs: p ? num(p.commit_latency_ms) : undefined,
      applyMs: p ? num(p.apply_latency_ms) : undefined,
      flags: arr<string>(d?.state).filter(s => /^no(out|in|up|down)$/.test(s)),
      meta: meta?.get(id),
    });
  }
  osds.sort((a, b) => a.id - b.id);
  const buckets: CrushBucket[] = nodes
    .filter((n: any) => n?.type !== 'osd')
    .map((n: any) => ({
      id: num(n.id),
      name: str(n.name),
      type: str(n.type),
      children: arr<number>(n.children).map(Number),
      sizeBytes: num(n.kb) * 1024,
      usedBytes: num(n.kb_used) * 1024,
      utilization: num(n.utilization),
    }));
  const osdById = new Map(osds.map(o => [o.id, o]));
  const hosts: CrushHost[] = buckets
    .filter(b => b.type === 'host')
    .map(b => {
      const ids = b.children.filter(c => c >= 0).sort((x, y) => x - y);
      const node = ids.map(i => osdById.get(i)?.meta?.hostname).find(Boolean);
      return { ...b, osds: ids, node };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const roots = buckets.filter(b => !parentOf.has(b.id)).map(b => b.id);
  return { osds, hosts, buckets, roots };
}

/* ---------------------------------------------------------------- pools */

/** "df detail" → usage per pool id, and cluster totals (per device class too). */
export function parseDf(raw: any): {
  total: number;
  avail: number;
  usedRaw: number;
  byClass: Record<string, { total: number; avail: number; usedRaw: number }>;
  pools: Map<number, PoolUsage>;
} {
  const d = obj(raw);
  const st = obj(d.stats);
  const pools = new Map<number, PoolUsage>();
  for (const p of arr(d.pools)) {
    const s = obj(p.stats);
    pools.set(num(p.id), {
      stored: num(s.stored),
      storedRaw: num(s.stored_raw),
      used: num(s.bytes_used),
      maxAvail: num(s.max_avail),
      percentUsed: num(s.percent_used),
      objects: num(s.objects),
      quotaBytes: num(s.quota_bytes),
      quotaObjects: num(s.quota_objects),
      compressBytesUsed: num(s.compress_bytes_used),
      compressUnderBytes: num(s.compress_under_bytes),
      rdOps: num(s.rd),
      rdBytes: num(s.rd_bytes),
      wrOps: num(s.wr),
      wrBytes: num(s.wr_bytes),
    });
  }
  const byClass: Record<string, { total: number; avail: number; usedRaw: number }> = {};
  for (const [c, v] of Object.entries(obj(d.stats_by_class))) {
    byClass[c] = { total: num((v as any).total_bytes), avail: num((v as any).total_avail_bytes), usedRaw: num((v as any).total_used_raw_bytes) };
  }
  return { total: num(st.total_bytes), avail: num(st.total_avail_bytes), usedRaw: num(st.total_used_raw_bytes), byClass, pools };
}

/** "osd crush rule dump". */
export function parseCrushRules(raw: any): CrushRule[] {
  return arr(raw).map((r: any) => {
    const steps = arr(r.steps);
    const take = steps.find((s: any) => s.op === 'take');
    const choose = steps.find((s: any) => /^choose(leaf)?_/.test(str(s.op)));
    const takeName = str(take?.item_name);
    const m = takeName.match(/^(.*)~(.+)$/);
    return {
      id: num(r.rule_id),
      name: str(r.rule_name),
      type: num(r.type) === 3 ? 'erasure' : num(r.type) === 1 ? 'replicated' : str(r.type),
      root: m ? m[1] : takeName,
      deviceClass: m ? m[2] : undefined,
      failureDomain: str(choose?.type, 'osd'),
    };
  });
}

/** Pools from "osd pool ls detail" (or osd dump's pools), joined with usage and rules. */
export function parsePools(raw: any, usage?: Map<number, PoolUsage>, rules?: CrushRule[], ecProfiles?: Record<string, Record<string, string>>): Pool[] {
  const ruleBy = new Map((rules ?? []).map(r => [r.id, r]));
  return arr(raw)
    .map((p: any): Pool => {
      const id = num(p.pool ?? p.pool_id);
      const erasure = num(p.type) === 3;
      const prof = erasure ? obj(ecProfiles?.[str(p.erasure_code_profile)]) : {};
      const k = num(prof.k);
      const m = num(prof.m);
      const size = num(p.size);
      return {
        id,
        name: str(p.pool_name),
        type: erasure ? 'erasure' : 'replicated',
        size,
        minSize: num(p.min_size),
        crushRuleId: num(p.crush_rule),
        crushRule: ruleBy.get(num(p.crush_rule))?.name ?? String(p.crush_rule ?? ''),
        pgNum: num(p.pg_num),
        pgpNum: num(p.pg_placement_num ?? p.pgp_num),
        pgNumTarget: num(p.pg_num_target, num(p.pg_num)),
        autoscaleMode: str(p.pg_autoscale_mode, 'on'),
        applications: Object.keys(obj(p.application_metadata)),
        compressionMode: str(obj(p.options).compression_mode, 'none'),
        ecProfile: str(p.erasure_code_profile),
        ec: erasure && k > 0 ? { k, m } : undefined,
        flags: str(p.flags_names).split(',').filter(Boolean),
        quotaBytes: num(p.quota_max_bytes),
        quotaObjects: num(p.quota_max_objects),
        rawFactor: erasure ? (k > 0 ? (k + m) / k : size) : Math.max(1, size),
        createdAt: cephTime(p.create_time),
        usage: usage?.get(id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "osd pool autoscale-status" (mgr). */
export function parseAutoscale(raw: any): AutoscaleStatus[] {
  return arr(raw).map((a: any) => ({
    poolId: num(a.pool_id),
    pool: str(a.pool_name),
    pgNum: num(a.pg_num_target),
    pgNumIdeal: num(a.pg_num_ideal),
    pgNumFinal: num(a.pg_num_final),
    mode: str(a.pg_autoscale_mode),
    bulk: !!a.bulk,
    wouldAdjust: !!a.would_adjust,
    targetRatio: num(a.target_ratio),
    targetBytes: num(a.target_bytes),
    capacityRatio: num(a.capacity_ratio),
  }));
}

/** "osd pool stats" (mgr): client and recovery rates per pool id. */
export function parsePoolStats(raw: any): Map<number, { io: Pool['io']; recovering: boolean }> {
  const out = new Map<number, { io: Pool['io']; recovering: boolean }>();
  for (const p of arr(raw)) {
    const c = obj(p.client_io_rate);
    out.set(num(p.pool_id), {
      io: { readBps: num(c.read_bytes_sec), writeBps: num(c.write_bytes_sec), readOps: num(c.read_op_per_sec), writeOps: num(c.write_op_per_sec) },
      recovering: Object.keys(obj(p.recovery_rate)).length > 0 || Object.keys(obj(p.recovery)).length > 0,
    });
  }
  return out;
}

/* ------------------------------------------------------- daemons & more */

/** "quorum_status". */
export function parseQuorum(raw: any): Quorum {
  const q = obj(raw);
  const mm = obj(q.monmap);
  const inQ = new Set(arr<string>(q.quorum_names));
  const cipher = (c: any) => str(c?.name ?? c);
  return {
    leader: str(q.quorum_leader_name),
    quorum: arr<string>(q.quorum_names),
    ageSec: num(q.quorum_age),
    mons: arr(mm.mons).map((m: any) => ({
      rank: num(m.rank),
      name: str(m.name),
      addr: str(m.public_addr ?? m.addr).replace(/\/\d+$/, ''),
      inQuorum: inQ.has(str(m.name)),
      leader: str(m.name) === str(q.quorum_leader_name),
    })),
    allowedCiphers: arr(mm.auth_allowed_ciphers).map(cipher),
    preferredCipher: cipher(mm.auth_preferred_cipher),
    serviceCipher: cipher(mm.auth_service_cipher),
    minMonRelease: str(mm.min_mon_release_name),
  };
}

/** "mgr dump" (projected). */
export function parseMgr(raw: any): MgrInfo {
  const m = obj(raw);
  const alwaysOn = obj(m.always_on_modules);
  const rel = Object.keys(alwaysOn).sort().pop();
  return {
    active: str(m.active_name),
    standbys: arr(m.standbys).map((s: any) => str(s?.name ?? s)),
    available: !!m.available,
    modules: arr<string>(m.modules),
    alwaysOn: rel ? arr<string>(alwaysOn[rel]) : [],
    services: obj(m.services),
    activeSince: cephTime(m.active_change),
  };
}

/** "versions". */
export function parseVersions(raw: any): Versions {
  const out: Versions = {};
  for (const [daemon, v] of Object.entries(obj(raw))) {
    out[daemon] = {};
    for (const [full, n] of Object.entries(obj(v))) out[daemon][shortVersion(full)] = num(n);
  }
  return out;
}

/** "ceph version 20.2.4 (7f79…) tentacle (stable - RelWithDebInfo)" → "20.2.4 tentacle". */
export function shortVersion(full: string): string {
  const m = full.match(/ceph version (\S+)(?: \([0-9a-f]+\))? ?(\w+)?/);
  return m ? `${m[1]}${m[2] ? ` ${m[2]}` : ''}` : full;
}

/** "crash ls" (mgr). */
export function parseCrashes(raw: any): CrashEntry[] {
  return arr(raw)
    .map((c: any) => ({
      id: str(c.crash_id),
      entity: str(c.entity_name),
      time: cephTime(c.timestamp),
      archived: !!c.archived,
      version: c.ceph_version ? str(c.ceph_version) : undefined,
      process: c.process_name ? str(c.process_name) : undefined,
    }))
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
}

/** "pg dump pgs_brief" (mgr). */
export function parsePgBrief(raw: any): PgBrief[] {
  const list = Array.isArray(raw) ? raw : arr(obj(raw).pg_stats);
  return list.map((p: any) => ({
    pgid: str(p.pgid),
    pool: num(str(p.pgid).split('.')[0]),
    state: str(p.state),
    up: arr<number>(p.up),
    acting: arr<number>(p.acting),
    primary: num(p.acting_primary, -1),
  }));
}

/** "log last" entries, newest first. */
export function parseLog(raw: any): LogEntry[] {
  return arr(raw)
    .map((e: any) => ({
      time: cephTime(e.stamp),
      who: str(e.name),
      channel: str(e.channel),
      priority: str(e.priority).replace(/[[\]]/g, ''),
      message: str(e.message),
      seq: num(e.seq),
    }))
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0) || b.seq - a.seq);
}

/** "config dump". */
export function parseConfig(raw: any): ConfigEntry[] {
  return arr(raw).map((c: any) => ({
    section: str(c.section),
    name: str(c.name),
    value: str(c.value),
    level: str(c.level),
    runtime: !!c.can_update_at_runtime,
    mask: str(c.mask),
  }));
}
