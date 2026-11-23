/*
 * Cluster flags (noout, norebalance, pause…) with what each does, set and
 * unset behind a confirmation; flags on single OSDs and on CRUSH buckets
 * (hosts in maintenance) with a way to clear them.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { cephOp } from '../../api/osdOps';
import { cliText } from '../../model/health';
import { CLUSTER_FLAGS, flagCommand, FlagInfo, osdCmd, setFlags } from '../../model/osd';
import { confirm } from '../../ui/dialogs';
import { Action, Mono, Notice, Panel, Tag } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { CommandList, Hint, useCephReason } from '../overview/common';

/** Flags on CRUSH buckets (osd set-group): bucket name → flags. */
export function useNodeFlags(): Record<string, string[]> {
  return useCeph().core.osdMap?.crushNodeFlags ?? {};
}

export function ClusterFlags() {
  const t = useTokens();
  const c = useCeph();
  const reason = useCephReason();
  const set = setFlags(c.core.osdMap);
  const nodeFlags = useNodeFlags();
  const osdFlags = c.core.osds.filter(o => o.flags.length);
  const [err, setErr] = React.useState<string | null>(null);
  const toggle = async (f: FlagInfo, on: boolean) => {
    const cmd = flagCommand(f.flag, on);
    const ok = await confirm({
      title: on ? `Set ${f.flag}?` : `Unset ${f.flag}?`,
      body: (
        <>
          {on && f.danger && (
            <Notice tone="err" sx={{ mb: 1.5 }}>
              {f.danger}
            </Notice>
          )}
          <CommandList cmds={[cliText(cmd)]} />
        </>
      ),
      consequences: on ? [f.meaning, `Use it for: ${f.when}`] : [`Ceph goes back to normal: ${unsetEffect(f.flag)}`],
      confirm: on ? `Set ${f.flag}` : `Unset ${f.flag}`,
      danger: on && !!f.danger,
      typeToConfirm: on && f.flag === 'pause' ? 'pause' : undefined,
    });
    if (!ok) return;
    setErr(null);
    try {
      await cephOp(c.ns, { title: `${on ? 'Set' : 'Unset'} the cluster flag ${f.flag}`, target: 'cluster flags', cmd, after: c.refresh });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const clearNode = async (bucket: string, flags: string[]) => {
    const cmds = flags.map(f => osdCmd.unsetGroup(f, [bucket]));
    const ok = await confirm({
      title: `Clear ${flags.join(', ')} on ${bucket}?`,
      body: <CommandList cmds={cmds.map(cliText)} />,
      consequences: [`The OSDs under ${bucket} behave normally again (Ceph marks them out when they stay down).`],
      confirm: 'Clear',
    });
    if (!ok) return;
    setErr(null);
    try {
      for (const [i, cmd] of cmds.entries())
        await cephOp(c.ns, { title: `Clear ${flags[i]} on ${bucket}`, target: bucket, cmd, invalidate: 'osds.nodeflags', after: c.refresh });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const nodeEntries = Object.entries(nodeFlags).filter(([, f]) => f.length);
  return (
    <Panel title="Cluster flags" icon="mdi:flag-outline" id="flags" actions={<Hint>{set.size ? `${set.size} set` : 'None set'}</Hint>}>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {CLUSTER_FLAGS.map((f, i) => {
          const on = set.has(f.flag);
          return (
            <Box
              component="li"
              key={f.flag}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(150px, 190px) 1fr auto',
                gap: 1.5,
                alignItems: 'center',
                py: 0.9,
                borderTop: i ? `1px solid ${t.rule}` : 'none',
                background: on ? t.tint[f.danger ? 'err' : 'warn'] : 'transparent',
                mx: -2,
                px: 2,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Mono>{f.flag}</Mono>
                <Box sx={{ mt: 0.25 }}>
                  <StateLabel tone={on ? (f.danger ? 'err' : 'warn') : 'idle'} size="sm">
                    {on ? 'Set' : 'Not set'}
                  </StateLabel>
                </Box>
              </Box>
              <Box sx={{ fontSize: 13.5, lineHeight: 1.5, minWidth: 0 }}>
                <Box sx={{ fontWeight: 600, display: 'flex', gap: 1, alignItems: 'center' }}>
                  {f.label}
                  {f.danger && (
                    <Tag tone="err" title={f.danger}>
                      Risky
                    </Tag>
                  )}
                </Box>
                <Box sx={{ color: t.muted }}>
                  {f.meaning} {f.when}
                </Box>
              </Box>
              <Action onClick={() => toggle(f, !on)} reason={reason}>
                {on ? 'Unset' : 'Set'}
              </Action>
            </Box>
          );
        })}
      </Box>
      {(nodeEntries.length > 0 || osdFlags.length > 0) && (
        <Box sx={{ mt: 2 }}>
          <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>
            Flags on hosts and OSDs
          </Typography>
          {nodeEntries.map(([bucket, flags]) => (
            <Box key={bucket} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5, flexWrap: 'wrap' }}>
              <Mono>{bucket}</Mono>
              {flags.map(f => (
                <Tag key={f} tone="warn">
                  {f}
                </Tag>
              ))}
              <Box sx={{ flex: 1 }} />
              <Action onClick={() => clearNode(bucket, flags)} reason={reason}>
                Clear
              </Action>
            </Box>
          ))}
          {osdFlags.map(o => (
            <Box key={o.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5, flexWrap: 'wrap' }}>
              <Mono>{o.name}</Mono>
              {o.flags.map(f => (
                <Tag key={f} tone="warn">
                  {f}
                </Tag>
              ))}
              <Hint>Clear it from the OSD’s page.</Hint>
            </Box>
          ))}
        </Box>
      )}
      {err && (
        <Notice tone="err" title="The flag change failed" sx={{ mt: 1.5 }}>
          {err}
        </Notice>
      )}
    </Panel>
  );
}

function unsetEffect(flag: string): string {
  switch (flag) {
    case 'noout':
      return 'OSDs that stay down for 10 minutes are marked out and their copies rebuilt elsewhere.';
    case 'noin':
      return 'OSDs that start are marked in and receive data.';
    case 'nodown':
      return 'OSDs that stop answering are marked down again.';
    case 'noup':
      return 'OSDs that start are marked up.';
    case 'norebalance':
    case 'nobackfill':
      return 'data that waited starts moving now: expect backfill traffic.';
    case 'norecover':
      return 'degraded data is rebuilt now: expect recovery traffic.';
    case 'noscrub':
    case 'nodeep-scrub':
      return 'scrubs that are overdue start soon.';
    case 'pause':
      return 'clients read and write again.';
    default:
      return 'the flag no longer applies.';
  }
}
