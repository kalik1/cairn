/*
 * Every active health check, expanded: Ceph's words and detail lines, what
 * it means in plain words, what to do, how long it has been there; mute
 * and unmute in Ceph, or persistently through Rook. Current mutes, and the
 * checks Ceph saw in the past.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { muteCheck, unmuteCheck } from '../../api/healthOps';
import { useKube } from '../../api/kube';
import { rookMutes, setRookMute } from '../../model/clusterSpec';
import { ago } from '../../model/format';
import { checkInfo, cliText, MUTE_TTLS, muteCommand } from '../../model/health';
import { HealthCheck, HealthHistoryEntry, HealthMute } from '../../model/types';
import { previewChange } from '../../ui/ChangeDialog';
import { openDialog } from '../../ui/dialogs';
import { healthTone } from '../../ui/health';
import { Action, Mono, Notice, Panel, Tag } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { Collapsible, CommandList, DocLink, fresh, Hint, useCephReason, useClusterEditReason, ViewLink } from './common';

const sevWord = (s: string) => (s === 'HEALTH_ERR' ? 'Error' : s === 'HEALTH_WARN' ? 'Warning' : 'OK');

export function HealthChecks() {
  const { core } = useCeph();
  const kube = useKube();
  const health = core.health ?? core.status?.health ?? null;
  const checks = health?.checks ?? [];
  const rook = rookMutes(kube.cephCluster);
  const past = core.healthHistory.filter(e => !e.active);
  return (
    <Panel
      title="Health checks"
      icon="mdi:stethoscope"
      actions={<Hint>{checks.length ? `${checks.length} active` : 'None active'}</Hint>}
      id="health"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {checks.length === 0 && <Notice tone="ok">Ceph reports no health checks: nothing needs attention.</Notice>}
        {checks.map(c => (
          <CheckBlock key={c.code} check={c} rookPolicy={rook[c.code]} />
        ))}
        <Mutes mutes={health?.mutes ?? []} rook={rook} />
        <Collapsible title="Past checks" count={past.length}>
          <PastChecks entries={past} />
        </Collapsible>
      </Box>
    </Panel>
  );
}

function CheckBlock({ check, rookPolicy }: { check: HealthCheck; rookPolicy?: 'mute' | 'unmute' }) {
  const t = useTokens();
  const c = useCeph();
  const reason = useCephReason();
  const info = checkInfo(check.code, check);
  const tone = healthTone(check.severity);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const unmute = async () => {
    setBusy(true);
    setErr(null);
    try {
      await unmuteCheck(c.ns, check.code, c.refresh);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box
      component="article"
      aria-label={`${sevWord(check.severity)} ${check.code}`}
      sx={{ borderLeft: `3px solid ${check.muted ? t.rule : tone === 'err' ? '#D3424F' : '#D9A02B'}`, pl: 1.75, py: 0.25 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 260 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <StateLabel tone={check.muted ? 'idle' : tone}>{sevWord(check.severity)}</StateLabel>
            <Typography component="h3" sx={{ fontSize: 15, fontWeight: 600 }}>
              {info.title}
            </Typography>
            <Mono muted>{check.code}</Mono>
            {check.muted && <Tag>Muted</Tag>}
            {rookPolicy === 'mute' && <Tag title="spec.healthCheck.muteHealthWarning in the CephCluster">Muted through Rook</Tag>}
          </Box>
          <Box sx={{ fontSize: 13.5, mt: 0.5 }}>
            {check.summary}
            <Box component="span" sx={{ color: t.muted }}>
              {check.count > 1 ? `; ${check.count} affected` : ''}
              {check.firstSeen ? `; first seen ${ago(check.firstSeen)}` : ''}
            </Box>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {check.muted ? (
            <Action icon="mdi:bell-ring-outline" onClick={unmute} disabled={busy} reason={reason}>
              Unmute
            </Action>
          ) : (
            <Action icon="mdi:bell-off-outline" onClick={() => openMuteDialog(check, c.ns, c.refresh)} reason={reason}>
              Mute…
            </Action>
          )}
        </Box>
      </Box>
      {check.details.length > 0 && (
        <Box
          component="ul"
          aria-label="Detail"
          sx={{
            m: 0,
            mt: 1,
            pl: 2.25,
            fontFamily: t.font.mono,
            fontSize: 12.5,
            lineHeight: 1.6,
            maxHeight: 220,
            overflowY: 'auto',
            color: t.text,
          }}
        >
          {check.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </Box>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1, md: 3 }, mt: 1.25, fontSize: 13.5, lineHeight: 1.55 }}>
        <Box>
          <Box sx={{ fontWeight: 600, fontSize: 13 }}>What it means</Box>
          <Box>{info.meaning}</Box>
          <Box sx={{ fontWeight: 600, fontSize: 13, mt: 0.75 }}>Impact</Box>
          <Box>{info.impact}</Box>
        </Box>
        <Box>
          <Box sx={{ fontWeight: 600, fontSize: 13 }}>What to do</Box>
          <Box component="ol" sx={{ m: 0, pl: 2.5, '& li': { mb: 0.25 } }}>
            {info.todo.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mt: 0.75, flexWrap: 'wrap' }}>
            {info.link && (
              <ViewLink view={info.link.view} a={info.link.a}>
                {info.link.label}
              </ViewLink>
            )}
            <DocLink href={info.docs}>Ceph documentation</DocLink>
          </Box>
        </Box>
      </Box>
      {err && (
        <Notice tone="err" title="Unmute failed" sx={{ mt: 1 }}>
          {err}
        </Notice>
      )}
    </Box>
  );
}

/* ----------------------------------------------------------- mute dialog */

function openMuteDialog(check: HealthCheck, ns: string, refresh: () => void) {
  openDialog(close => <MuteDialog check={check} ns={ns} refresh={refresh} onClose={close} />);
}

function MuteDialog({ check, ns, refresh, onClose }: { check: HealthCheck; ns: string; refresh: () => void; onClose: () => void }) {
  const kube = useKube();
  const editReason = useClusterEditReason();
  const info = checkInfo(check.code, check);
  const [ttl, setTtl] = React.useState('1d');
  const [sticky, setSticky] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const cmd = muteCommand(check.code, ttl, sticky);
  const mute = async () => {
    setBusy(true);
    setErr(null);
    try {
      await muteCheck(ns, check.code, ttl, sticky, refresh);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const viaRook = async () => {
    if (!kube.cephCluster) return;
    const cc = await fresh(kube.cephCluster);
    try {
      const ch = setRookMute(cc, check.code, 'mute');
      onClose();
      previewChange({
        title: `Mute ${check.code} through Rook`,
        op: 'update',
        before: cc,
        after: ch.after,
        consequences: ch.notes,
        warning: info.noMute,
        action: 'Mute through Rook',
        target: check.code,
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="sm" fullWidth aria-labelledby="cairn-mute-title">
      <DialogTitle id="cairn-mute-title" sx={{ fontSize: 18 }}>
        Mute {check.code}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {info.noMute && <Notice tone="err">{info.noMute}</Notice>}
        <Typography sx={{ fontSize: 14, lineHeight: 1.55 }}>
          A muted check stays listed but no longer turns Ceph’s health to {sevWord(check.severity).toLowerCase()}. The problem itself does not
          go away.
        </Typography>
        <Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>For how long</Typography>
          <RadioGroup row value={ttl} onChange={e => setTtl(e.target.value)} aria-label="Mute duration">
            {MUTE_TTLS.map(o => (
              <FormControlLabel key={o.ttl || 'clear'} value={o.ttl} control={<Radio size="small" />} label={o.label} />
            ))}
          </RadioGroup>
          <FormControlLabel
            sx={{ alignItems: 'flex-start', mt: 0.5 }}
            control={<Checkbox checked={sticky} onChange={e => setSticky(e.target.checked)} sx={{ mt: -0.75 }} />}
            label={
              <Box>
                <Typography sx={{ fontSize: 14 }}>Sticky</Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  Keep the mute when the check clears and comes back, or gets worse (more items affected). Without it, Ceph lifts the mute then.
                </Typography>
              </Box>
            }
          />
        </Box>
        <CommandList cmds={[cliText(cmd)]} />
        <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Or mute it through Rook</Typography>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Persistent: the CephCluster gets spec.healthCheck.muteHealthWarning.{check.code} with policy mute, and Rook keeps the check muted
            until you set the policy to unmute. You see the change before anything is applied.
          </Typography>
          <Action icon="mdi:file-document-edit-outline" sx={{ mt: 1 }} onClick={viaRook} reason={editReason ?? (kube.cephCluster ? null : 'No CephCluster')}>
            Preview the Rook change
          </Action>
        </Box>
        {err && (
          <Notice tone="err" title="Could not mute">
            {err}
          </Notice>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={busy}>
          Cancel
        </Button>
        <Button onClick={mute} variant="contained" disabled={busy} color={info.noMute ? 'error' : 'primary'}>
          Mute in Ceph
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------------------------------------- mutes */

function Mutes({ mutes, rook }: { mutes: HealthMute[]; rook: Record<string, 'mute' | 'unmute'> }) {
  const t = useTokens();
  const c = useCeph();
  const kube = useKube();
  const reason = useCephReason();
  const editReason = useClusterEditReason();
  const [err, setErr] = React.useState<string | null>(null);
  const rookCodes = Object.entries(rook);
  if (!mutes.length && !rookCodes.length) return null;
  const unmute = async (code: string) => {
    setErr(null);
    try {
      await unmuteCheck(c.ns, code, c.refresh);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const rookUnmute = async (code: string) => {
    if (!kube.cephCluster) return;
    const cc = await fresh(kube.cephCluster);
    try {
      const ch = setRookMute(cc, code, 'unmute');
      previewChange({ title: `Unmute ${code} through Rook`, op: 'update', before: cc, after: ch.after, consequences: ch.notes, action: 'Unmute through Rook', target: code });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Box>
      <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, mb: 0.75 }}>
        Current mutes
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {mutes.map(m => (
          <Box component="li" key={`ceph-${m.code}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, borderTop: `1px solid ${t.rule}`, flexWrap: 'wrap' }}>
            <Mono>{m.code}</Mono>
            <Box sx={{ flex: 1, fontSize: 13.5, color: t.muted, minWidth: 200 }}>
              In Ceph, {m.until ? `until ${new Date(m.until).toLocaleString()}` : 'until the check clears'}
              {m.sticky ? ', sticky' : ''}
              {rook[m.code] === 'mute' ? '; Rook keeps it muted' : ''}
            </Box>
            <Action onClick={() => unmute(m.code)} reason={reason ?? (rook[m.code] === 'mute' ? 'Rook mutes it again: unmute it through Rook' : null)}>
              Unmute
            </Action>
          </Box>
        ))}
        {rookCodes.map(([code, policy]) => (
          <Box component="li" key={`rook-${code}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, borderTop: `1px solid ${t.rule}`, flexWrap: 'wrap' }}>
            <Mono>{code}</Mono>
            <Box sx={{ flex: 1, fontSize: 13.5, color: t.muted, minWidth: 200 }}>
              Through Rook: policy {policy}
              {policy === 'unmute' ? ' (the entry can be removed)' : ''}
            </Box>
            {policy === 'mute' && (
              <Action onClick={() => rookUnmute(code)} reason={editReason}>
                Unmute through Rook
              </Action>
            )}
          </Box>
        ))}
      </Box>
      {err && (
        <Notice tone="err" title="Unmute failed" sx={{ mt: 1 }}>
          {err}
        </Notice>
      )}
    </Box>
  );
}

function PastChecks({ entries }: { entries: HealthHistoryEntry[] }) {
  const t = useTokens();
  if (!entries.length) return <Hint>Ceph remembers no past checks.</Hint>;
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {entries.map(e => (
        <Box component="li" key={e.code} sx={{ display: 'flex', gap: 1.5, py: 0.75, borderTop: `1px solid ${t.rule}`, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13.5 }}>
          <StateLabel tone="idle" size="sm">
            {sevWord(e.severity)}
          </StateLabel>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            {checkInfo(e.code).title} <Mono muted>{e.code}</Mono>
          </Box>
          <Box sx={{ color: t.muted }}>
            {e.firstSeen ? new Date(e.firstSeen).toLocaleString() : '—'} to {e.lastSeen ? new Date(e.lastSeen).toLocaleString() : '—'}
          </Box>
          <DocLink href={checkInfo(e.code).docs}>Docs</DocLink>
        </Box>
      ))}
    </Box>
  );
}
