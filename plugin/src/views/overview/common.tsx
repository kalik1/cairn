/*
 * Small pieces shared by the Overview, Hosts & OSDs and Daemons views:
 * links into Cairn and into Headlamp, a collapsible section, the reason a
 * Ceph operation is disabled, and an error notice for failed operations.
 */

import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Link from '@mui/material/Link';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { pathOf } from '../../api/apply';
import { useCeph } from '../../api/ceph';
import { kget } from '../../api/client';
import { denied, rookAttrs, useCan } from '../../api/permissions';
import { Obj } from '../../model/types';
import { hrefFor, View } from '../../shell/nav';
import { Mono } from '../../ui/kit';
import { useTokens } from '../../ui/useTokens';

/** A link to a Cairn view. */
export function ViewLink({ view, a, b, children, title }: { view: View; a?: string; b?: string; children: React.ReactNode; title?: string }) {
  return (
    <Link component={RouterLink} to={hrefFor(view, a, b)} underline="hover" title={title} sx={{ fontWeight: 500 }}>
      {children}
    </Link>
  );
}

/** Headlamp's own page for a Kubernetes object, when the route exists. */
export function headlampUrl(route: string, params: Record<string, string>): string | null {
  try {
    return Router.createRouteURL(route, params);
  } catch {
    return null;
  }
}

export function PodLink({ namespace, name, muted }: { namespace?: string; name?: string; muted?: boolean }) {
  if (!name) return <>—</>;
  const url = namespace ? headlampUrl('pod', { namespace, name }) : null;
  if (!url) return <Mono muted={muted}>{name}</Mono>;
  return (
    <Link component={RouterLink} to={url} underline="hover" title={`Open pod ${namespace}/${name} in Headlamp`}>
      <Mono>{name}</Mono>
    </Link>
  );
}

export function NodeLink({ name }: { name?: string }) {
  if (!name) return <>—</>;
  const url = headlampUrl('node', { name });
  if (!url) return <Mono>{name}</Mono>;
  return (
    <Link component={RouterLink} to={url} underline="hover" title={`Open node ${name} in Headlamp`}>
      <Mono>{name}</Mono>
    </Link>
  );
}

/** An external documentation link (opens a new tab). */
export function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
      {children}
      <Icon icon="mdi:open-in-new" width={13} />
    </Link>
  );
}

/** A section that opens and closes; closed by default. */
export function Collapsible({
  title,
  children,
  initial = false,
  count,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  initial?: boolean;
  count?: number;
}) {
  const t = useTokens();
  const [open, setOpen] = React.useState(initial);
  const id = React.useId();
  return (
    <Box>
      <ButtonBase
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={id}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 0.5,
          py: 0.5,
          borderRadius: 1,
          fontSize: 14,
          fontWeight: 600,
          color: t.text,
          '&:focus-visible': { outline: `2px solid ${t.meterUsed}` },
        }}
      >
        <Icon icon={open ? 'mdi:chevron-down' : 'mdi:chevron-right'} width={18} />
        {title}
        {count !== undefined && (
          <Box component="span" sx={{ color: t.muted, fontWeight: 400 }}>
            ({count})
          </Box>
        )}
      </ButtonBase>
      {open && (
        <Box id={id} sx={{ mt: 1 }}>
          {children}
        </Box>
      )}
    </Box>
  );
}

/** Why Ceph operations are off right now (no bridge), or null. */
export function useCephReason(): string | null {
  const c = useCeph();
  if (c.phase === 'ready') return null;
  return c.reason || 'Ceph commands cannot run right now';
}

/** Why the CephCluster cannot be edited (RBAC), or null. */
export function useClusterEditReason(): string | null {
  const c = useCeph();
  const ok = useCan(rookAttrs('update', 'cephclusters', c.ns));
  return denied(ok, 'editing the CephCluster');
}

/** A compact line of muted text. */
export function Hint({ children, sx }: { children: React.ReactNode; sx?: object }) {
  const t = useTokens();
  return <Box sx={{ fontSize: 12.5, color: t.muted, lineHeight: 1.5, ...sx }}>{children}</Box>;
}

/** A code block for commands shown before they run. */
export function CommandList({ cmds }: { cmds: string[] }) {
  const t = useTokens();
  return (
    <Box
      component="pre"
      aria-label="Commands"
      sx={{
        m: 0,
        p: 1,
        fontFamily: t.font.mono,
        fontSize: 12.5,
        lineHeight: 1.6,
        background: t.sunken,
        border: `1px solid ${t.rule}`,
        borderRadius: `${t.radius.small}px`,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      {cmds.join('\n')}
    </Box>
  );
}

/**
 * The object as the API server has it now. Rook rewrites the CephCluster
 * status every minute, so a copy from the last list poll often carries an
 * old resourceVersion and the update (even the dry run) is refused with a
 * conflict: build changes on a fresh copy.
 */
export async function fresh(o: Obj): Promise<Obj> {
  try {
    const cur = await kget<Obj>(pathOf(o));
    return cur && cur.metadata ? { ...cur, apiVersion: cur.apiVersion ?? o.apiVersion, kind: cur.kind ?? o.kind } : o;
  } catch {
    return o;
  }
}
