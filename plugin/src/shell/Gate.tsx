/*
 * What a view shows when Ceph's live state is not there: no CephCluster,
 * no permission to run Ceph commands, no pod to run them in, still
 * checking. Views wrap the parts that need live data in <LiveGate>; the
 * Kubernetes parts render regardless.
 */

import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import React from 'react';
import { useCeph } from '../api/ceph';
import { Empty, Notice } from '../ui/kit';

export function LiveGate({ children, compact, what }: { children: React.ReactNode; compact?: boolean; what?: string }) {
  const c = useCeph();
  if (c.phase === 'ready' && (c.updatedAt || c.error)) {
    if (!c.updatedAt && c.error)
      return (
        <Notice tone="err" title="Ceph is not answering">
          {c.error}
        </Notice>
      );
    return <>{children}</>;
  }
  if (c.phase === 'checking' || c.phase === 'ready') return <Loading compact={compact} />;
  if (c.phase === 'nocluster') return compact ? null : <NoCluster />;
  return <NoLive compact={compact} what={what} />;
}

export function Loading({ compact, label = "Reading Ceph's live state…" }: { compact?: boolean; label?: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        py: compact ? 1 : 4,
        justifyContent: compact ? 'flex-start' : 'center',
        color: 'text.secondary',
        fontSize: 14,
      }}
    >
      <CircularProgress size={18} /> {label}
    </Box>
  );
}

export function NoCluster() {
  return (
    <Empty icon="mdi:database-off-outline" title="No Ceph cluster here">
      Cairn manages Ceph clusters deployed by Rook. This cluster has no CephCluster you can see: install Rook and create a
      CephCluster, or ask for a role that can list cephclusters.ceph.rook.io.
    </Empty>
  );
}

export function NoLive({ compact, what }: { compact?: boolean; what?: string }) {
  const c = useCeph();
  const forbidden = c.phase === 'forbidden';
  return (
    <Notice
      tone={forbidden ? 'warn' : 'idle'}
      icon={forbidden ? 'mdi:lock-outline' : 'mdi:lan-disconnect'}
      title={forbidden ? `Ceph's live state needs more access${what ? ` (${what})` : ''}` : 'Ceph commands cannot run right now'}
    >
      <p>{c.reason}</p>
      {!compact && (
        <p>
          {forbidden
            ? 'What Kubernetes knows (Rook resources, their status, StorageClasses, volumes) is still shown. Storage admins get the cairn-admin role (distribution/rbac.yaml).'
            : 'Cairn runs Ceph commands in the Rook toolbox (app=rook-ceph-tools) or, without one, in the Rook operator pod. It retries on its own.'}
        </p>
      )}
    </Notice>
  );
}

/** A small "updated 5 s ago / failed" line for live panels. */
export function LiveStamp() {
  const c = useCeph();
  const [, tick] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, []);
  if (!c.updatedAt) return null;
  const s = Math.round((Date.now() - c.updatedAt) / 1000);
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 12.5, color: c.error ? 'error.main' : 'text.secondary' }}
      title={c.error ?? undefined}
    >
      <Icon icon={c.error ? 'mdi:alert-circle-outline' : 'mdi:sync'} width={14} />
      {c.error ? `Last update failed (data from ${s} s ago)` : s < 3 ? 'Live' : `Updated ${s} s ago`}
    </Box>
  );
}
