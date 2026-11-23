/*
 * Shared by the pool views (and the RBD views): pool rows joined with
 * their owner, rule, autoscaler state and StorageClasses; the context the
 * create/edit form needs; small links and tags.
 */

import MuiLink from '@mui/material/Link';
import React from 'react';
import { Link } from 'react-router-dom';
import { mon } from '../../api/bridge';
import { out, useCeph, useCephQuery } from '../../api/ceph';
import { useKube } from '../../api/kube';
import {
  CephFsEntry,
  domainCounts,
  FormContext,
  ImpactContext,
  PoolOwner,
  poolOwner,
  poolState,
  ScUse,
  storageClassesUsing,
} from '../../model/pools';
import { AutoscaleStatus, CrushRule, Pool } from '../../model/types';
import { StateTone } from '../../ui/tokens';

export interface PoolRow {
  pool: Pool;
  owner: PoolOwner;
  rule?: CrushRule;
  autoscale?: AutoscaleStatus;
  scs: ScUse[];
  state: { tone: StateTone; word: string; detail: string };
}

/** Ceph's filesystems (fs ls), for pool ownership. */
export function useCephFs(): CephFsEntry[] | undefined {
  const q = useCephQuery('pools:fsls', [mon('fs ls')], { intervalMs: 60000, staleMs: 30000 });
  return out<CephFsEntry[]>(q.data);
}

export function usePoolRows(): PoolRow[] {
  const c = useCeph();
  const k = useKube();
  const fs = useCephFs();
  return React.useMemo(() => {
    const ctx = {
      blockPools: k.blockPools.items.filter(p => p.metadata.namespace === k.ns),
      filesystems: k.filesystems.items.filter(p => p.metadata.namespace === k.ns),
      objectStores: k.objectStores.items.filter(p => p.metadata.namespace === k.ns),
      objectZones: k.objectZones.items.filter(p => p.metadata.namespace === k.ns),
      nfs: k.nfs.items.filter(p => p.metadata.namespace === k.ns),
      cephFs: fs,
    };
    return c.core.pools.map(p => ({
      pool: p,
      owner: poolOwner(p, ctx),
      rule: c.core.rules.find(r => r.id === p.crushRuleId),
      autoscale: c.core.autoscale.find(a => a.poolId === p.id),
      scs: storageClassesUsing(p.name, k.storageClasses.items, k.ns),
      state: poolState(p, c.core.pgs),
    }));
  }, [c.core.pools, c.core.rules, c.core.autoscale, c.core.pgs, k.blockPools, k.filesystems, k.objectStores, k.objectZones, k.nfs, k.storageClasses, k.ns, fs]);
}

/** Ceph's defaults that decide a new pool's PGs. */
export function usePgDefaults(): { defaultPgNum: number; maxPgPerOsd: number } {
  const q = useCephQuery(
    'pools:defaults',
    [mon('config get', { who: 'mon', key: 'osd_pool_default_pg_num' }), mon('config get', { who: 'mon', key: 'mon_max_pg_per_osd' })],
    { staleMs: 300000 }
  );
  return { defaultPgNum: Number(out(q.data, 0) ?? 32) || 32, maxPgPerOsd: Number(out(q.data, 1) ?? 250) || 250 };
}

/** What the pool form needs to validate and to tell the impact, for a device class. */
export function useFormContext(deviceClass: string): { form: FormContext; impact: ImpactContext } {
  const c = useCeph();
  const pg = usePgDefaults();
  return React.useMemo(() => {
    const domains = domainCounts(c.core.buckets, c.core.osds, deviceClass);
    const osds = c.core.osds.filter(o => o.in && (!deviceClass || o.deviceClass === deviceClass));
    const byClass = deviceClass ? c.core.df?.byClass[deviceClass] : undefined;
    const rawTotal = byClass?.total ?? c.core.df?.total ?? 0;
    const rawAvail = byClass?.avail ?? c.core.df?.avail ?? 0;
    const classes = [...new Set(c.core.osds.map(o => o.deviceClass).filter(Boolean))].sort();
    return {
      form: { cephPools: c.core.pools.map(p => p.name), crs: [], domains, deviceClasses: classes },
      impact: {
        domains,
        osds: osds.length,
        rawAvail,
        rawTotal,
        fullRatio: c.core.osdMap?.fullRatio ?? 0.95,
        defaultPgNum: pg.defaultPgNum,
        maxPgPerOsd: pg.maxPgPerOsd,
        maxPgsNow: Math.max(0, ...osds.map(o => o.pgs)),
      },
    };
  }, [c.core.buckets, c.core.osds, c.core.df, c.core.pools, c.core.osdMap, deviceClass, pg.defaultPgNum, pg.maxPgPerOsd]);
}

/** A link inside Headlamp (react-router), styled like MUI links. */
export function RLink({ to, children, title }: { to: string; children: React.ReactNode; title?: string }) {
  return (
    <MuiLink component={Link} to={to} title={title} underline="hover" sx={{ fontWeight: 500 }}>
      {children}
    </MuiLink>
  );
}

/** Rook resource phase → tone. */
export function phaseTone(phase?: string): StateTone {
  if (!phase) return 'idle';
  if (/^(Ready|Connected|Bound)$/i.test(phase)) return 'ok';
  if (/^(Progressing|Connecting|Creating|Pending)$/i.test(phase)) return 'move';
  if (/^(Failure|Failed|Error|ReconcileFailed)$/i.test(phase)) return 'err';
  if (/^(Deleting)$/i.test(phase)) return 'warn';
  return 'idle';
}

/** Stratum fills that read on the basalt band, for pools drawn side by side. */
export const STRATA = ['#5B97EA', '#9C7BD6', '#3FA996', '#B9A57A', '#7D9BB0', '#8FA35A', '#B07D5B', '#A87CA0'];
