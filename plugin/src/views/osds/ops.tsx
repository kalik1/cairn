/*
 * OSD operations with their confirmations: mark out / in, reweight,
 * per-OSD noout, scrub and deep scrub, the safety checks Ceph offers
 * (ok-to-stop, safe-to-destroy) and the guided maintenance of a host or
 * OSDs. Every confirmation lists what will happen and the exact command.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';
import { cephBatch } from '../../api/bridge';
import { useCeph } from '../../api/ceph';
import { cephOp, cephSteps, routed } from '../../api/osdOps';
import { bytes, plural } from '../../model/format';
import { cliText } from '../../model/health';
import { DestroyCheck, maintenancePlan, osdCmd, parseOkToStop, parseReweight, parseSafeToDestroy, StopCheck } from '../../model/osd';
import { Osd } from '../../model/types';
import { confirm, openDialog } from '../../ui/dialogs';
import { Mono, Notice } from '../../ui/kit';
import { CommandList, Hint } from '../overview/common';

const names = (osds: Osd[]) => osds.map(o => o.name).join(', ');
const total = (osds: Osd[], f: (o: Osd) => number) => osds.reduce((n, o) => n + f(o), 0);

/* --------------------------------------------------------- safety check */

/** Runs "osd ok-to-stop" and/or "osd safe-to-destroy" for the OSDs and shows Ceph's answer. */
export function SafetyCheck({ ids, stop = true, destroy = false }: { ids: number[]; stop?: boolean; destroy?: boolean }) {
  const { ns } = useCeph();
  const [res, setRes] = React.useState<{ stop: StopCheck | null; destroy: DestroyCheck | null } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const key = ids.join(',');
  React.useEffect(() => {
    let alive = true;
    const cmds = [...(stop ? [routed(osdCmd.okToStop(ids))] : []), ...(destroy ? [routed(osdCmd.safeToDestroy(ids))] : [])];
    cephBatch(ns, cmds)
      .then(r => {
        if (!alive) return;
        setRes({ stop: stop ? parseOkToStop(r[0]) : null, destroy: destroy ? parseSafeToDestroy(r[stop ? 1 : 0]) : null });
      })
      .catch(e => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ns, key, stop, destroy]);
  if (err)
    return (
      <Notice tone="err" title="The safety check failed">
        {err}
      </Notice>
    );
  if (!res)
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13.5, color: 'text.secondary', py: 0.5 }}>
        <CircularProgress size={14} /> Asking Ceph whether this is safe…
      </Box>
    );
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {res.stop && <StopResult c={res.stop} />}
      {res.destroy && (
        <Notice tone={res.destroy.safe ? 'ok' : 'warn'} title={res.destroy.safe ? 'Safe to destroy' : 'Not safe to destroy'}>
          {res.destroy.message}
          <Hint>osd safe-to-destroy: whether removing the OSD for good would lose data.</Hint>
        </Notice>
      )}
    </Box>
  );
}

const pgList = (l: string[], max = 12) => (l.length > max ? `${l.slice(0, max).join(', ')} and ${l.length - max} more` : l.join(', '));

function StopResult({ c }: { c: StopCheck }) {
  return (
    <Notice tone={c.ok ? 'ok' : 'err'} title={c.ok ? 'Safe to stop' : 'Not safe to stop'}>
      <p>{c.ok ? 'Every placement group stays active if these OSDs stop.' : c.message}</p>
      {c.becomeInactive.length > 0 && (
        <p>
          {plural(c.becomeInactive.length, 'placement group')} would become inactive (data unavailable): <Mono>{pgList(c.becomeInactive)}</Mono>
        </p>
      )}
      {c.alreadyInactive.length > 0 && (
        <p>
          Already inactive: <Mono>{pgList(c.alreadyInactive)}</Mono>
        </p>
      )}
      {c.unknown.length > 0 && (
        <p>
          State unknown: <Mono>{pgList(c.unknown)}</Mono>
        </p>
      )}
      {c.becomeDegraded.length > 0 && <p>{plural(c.becomeDegraded.length, 'placement group')} would run degraded (fewer copies) while they are down.</p>}
      <Hint>osd ok-to-stop: whether stopping them keeps every placement group active.</Hint>
    </Notice>
  );
}

/* ----------------------------------------------------- simple operations */

export async function markOut(ns: string, osds: Osd[], refresh: () => void) {
  const ids = osds.map(o => o.id);
  const cmd = osdCmd.out(ids);
  const ok = await confirm({
    title: `Mark ${names(osds)} out?`,
    body: (
      <>
        <SafetyCheck ids={ids} stop destroy />
        <Box sx={{ mt: 1.5 }}>
          <CommandList cmds={[cliText(cmd)]} />
        </Box>
      </>
    ),
    consequences: [
      `Ceph moves every placement group off ${names(osds)} (${plural(total(osds, o => o.pgs), 'placement group')}, about ${bytes(
        total(osds, o => o.usedBytes)
      )}) to other OSDs: disk and network load until it finishes.`,
      'The OSDs keep running and serve their data until it has moved.',
      'The other OSDs fill up by that much: check they have room.',
      'Mark them in again to move the data back.',
    ],
    confirm: 'Mark out',
    danger: true,
  });
  if (!ok) return;
  await cephOp(ns, { title: `Mark ${names(osds)} out`, target: names(osds), cmd, after: refresh });
}

export async function markIn(ns: string, osds: Osd[], refresh: () => void) {
  const cmd = osdCmd.in(osds.map(o => o.id));
  const ok = await confirm({
    title: `Mark ${names(osds)} in?`,
    body: <CommandList cmds={[cliText(cmd)]} />,
    consequences: [
      `Ceph places data on ${names(osds)} again and moves placement groups onto ${osds.length === 1 ? 'it' : 'them'} (backfill).`,
      'Expect disk and network load until the data is balanced.',
    ],
    confirm: 'Mark in',
  });
  if (!ok) return;
  await cephOp(ns, { title: `Mark ${names(osds)} in`, target: names(osds), cmd, after: refresh });
}

export async function setNoout(ns: string, osds: Osd[], on: boolean, refresh: () => void) {
  const ids = osds.map(o => o.id);
  const cmd = on ? osdCmd.addNoout(ids) : osdCmd.rmNoout(ids);
  const ok = await confirm({
    title: on ? `Keep ${names(osds)} in while down?` : `Clear noout on ${names(osds)}?`,
    body: <CommandList cmds={[cliText(cmd)]} />,
    consequences: on
      ? [
          `If ${osds.length === 1 ? 'it stops' : 'they stop'}, Ceph waits instead of marking ${osds.length === 1 ? 'it' : 'them'} out after 10 minutes: no data moves, but ${osds.length === 1 ? 'its' : 'their'} placement groups run degraded meanwhile.`,
          'Clear it when the work is done.',
        ]
      : ['Ceph marks these OSDs out again on its own when they stay down for 10 minutes, and rebuilds their copies elsewhere.'],
    confirm: on ? 'Set noout' : 'Clear noout',
  });
  if (!ok) return;
  await cephOp(ns, { title: on ? `Set noout on ${names(osds)}` : `Clear noout on ${names(osds)}`, target: names(osds), cmd, after: refresh });
}

export async function scrub(ns: string, osds: Osd[], deep: boolean, refresh: () => void) {
  const cmds = osds.map(o => (deep ? osdCmd.deepScrub(o.id) : osdCmd.scrub(o.id)));
  const ok = await confirm({
    title: `${deep ? 'Deep-scrub' : 'Scrub'} ${names(osds)}?`,
    body: <CommandList cmds={cmds.map(cliText)} />,
    consequences: [
      deep
        ? `Ceph reads every byte of every placement group whose primary is on ${names(osds)} and compares the copies: heavy disk reads for a while.`
        : `Ceph compares the copies of every placement group whose primary is on ${names(osds)} (metadata only): light load.`,
      'Scrubs are queued: they start when the OSD has a scrub slot, and respect the scrub flags (noscrub, nodeep-scrub).',
      'Errors found show up as the OSD_SCRUB_ERRORS and PG_DAMAGED health checks.',
    ],
    confirm: deep ? 'Deep-scrub' : 'Scrub',
  });
  if (!ok) return;
  for (const [i, o] of osds.entries())
    await cephOp(ns, { title: `${deep ? 'Deep-scrub' : 'Scrub'} ${o.name}`, target: o.name, cmd: cmds[i], after: i === osds.length - 1 ? refresh : undefined });
}

/* ------------------------------------------------------------- reweight */

export function openReweight(ns: string, osd: Osd, refresh: () => void) {
  openDialog(close => <ReweightDialog ns={ns} osd={osd} refresh={refresh} onClose={close} />);
}

function ReweightDialog({ ns, osd, refresh, onClose }: { ns: string; osd: Osd; refresh: () => void; onClose: () => void }) {
  const [text, setText] = React.useState(String(osd.reweight));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const v = parseReweight(text);
  const change = v === null ? 0 : v - osd.reweight;
  const moved = v === null || osd.reweight <= 0 ? 0 : Math.abs(change / osd.reweight) * osd.usedBytes;
  const cmd = v === null ? null : osdCmd.reweight(osd.id, v);
  const apply = async () => {
    if (!cmd) return;
    setBusy(true);
    setErr(null);
    try {
      await cephOp(ns, { title: `Reweight ${osd.name} to ${v}`, target: osd.name, cmd, after: refresh });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="sm" fullWidth aria-labelledby="cairn-reweight-title">
      <DialogTitle id="cairn-reweight-title" sx={{ fontSize: 18 }}>
        Reweight {osd.name}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: 14, lineHeight: 1.55 }}>
          The reweight (0 to 1) is a temporary override on top of the CRUSH weight: 1 takes the OSD’s full share of data, 0.8 about 80% of it,
          0 is the same as out. It is reset to 1 when the OSD is marked out and in again. Now: <Mono>{osd.reweight}</Mono>.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', flex: 1 }} role="group" aria-label="Common values">
            {[1, 0.95, 0.9, 0.85, 0.8, 0.5].map(n => (
              <Button key={n} size="small" variant={v === n ? 'contained' : 'outlined'} onClick={() => setText(String(n))} sx={{ minWidth: 48 }}>
                {n}
              </Button>
            ))}
          </Box>
          <TextField
            size="small"
            label="Reweight"
            value={text}
            onChange={e => setText(e.target.value)}
            error={v === null}
            helperText={v === null ? 'A number from 0 to 1, or a percentage' : ' '}
            sx={{ width: 140 }}
          />
        </Box>
        {v !== null && change !== 0 && (
          <Notice tone="warn" title={change < 0 ? 'Data moves off this OSD' : 'Data moves onto this OSD'}>
            About {bytes(moved)} {change < 0 ? `leaves ${osd.name} for other OSDs` : `moves to ${osd.name}`} (backfill): disk and network load until
            it settles.
          </Notice>
        )}
        {cmd && <CommandList cmds={[cliText(cmd)]} />}
        {err && (
          <Notice tone="err" title="Reweight failed">
            {err}
          </Notice>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={busy}>
          Cancel
        </Button>
        <Button onClick={apply} variant="contained" disabled={busy || v === null || change === 0}>
          Reweight
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------------------------------------------------- maintenance */

export function openMaintenance(ns: string, o: { osds: Osd[]; host?: string; node?: string }, refresh: () => void) {
  openDialog(close => <MaintenanceDialog ns={ns} {...o} refresh={refresh} onClose={close} />);
}

function MaintenanceDialog({
  ns,
  osds,
  host,
  node,
  refresh,
  onClose,
}: {
  ns: string;
  osds: Osd[];
  host?: string;
  node?: string;
  refresh: () => void;
  onClose: () => void;
}) {
  const [markOutToo, setMarkOutToo] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const ids = osds.map(o => o.id);
  const plan = maintenancePlan({ osds: ids, host, markOut: markOutToo });
  const what = host ? `host ${host}` : names(osds);
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      await cephSteps(ns, plan.start, what, refresh, 'osds.nodeflags');
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="md" fullWidth aria-labelledby="cairn-maint-title">
      <DialogTitle id="cairn-maint-title" sx={{ fontSize: 18 }}>
        Maintenance of {what}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        <Typography sx={{ fontSize: 14, lineHeight: 1.55 }}>
          Prepares {host ? `the node${node && node !== host ? ` ${node}` : ''} and its ${plural(osds.length, 'OSD')}` : names(osds)} for work that
          stops {osds.length === 1 && !host ? 'it' : 'them'} (reboot, disk or kernel change) without Ceph reacting as if {osds.length === 1 && !host ? 'it' : 'they'}{' '}
          had failed.
        </Typography>
        <Box>
          <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, mb: 0.75 }}>
            1. Check
          </Typography>
          <SafetyCheck ids={ids} stop />
        </Box>
        <Box>
          <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>
            2. Start
          </Typography>
          <FormControlLabel
            sx={{ alignItems: 'flex-start' }}
            control={<Checkbox checked={markOutToo} onChange={e => setMarkOutToo(e.target.checked)} sx={{ mt: -0.75 }} disabled={busy || done} />}
            label={
              <Box>
                <Typography sx={{ fontSize: 14 }}>Also mark {osds.length === 1 ? 'the OSD' : 'the OSDs'} out first</Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  For long work or a disk that will not come back: Ceph copies their data elsewhere before you stop anything, so nothing runs
                  degraded. It moves about {bytes(total(osds, o => o.usedBytes))} and takes a while.
                </Typography>
              </Box>
            }
          />
          {markOutToo && (
            <Notice tone="warn" sx={{ mt: 1 }} title="Data movement starts at once">
              Marking out starts backfill of {plural(total(osds, o => o.pgs), 'placement group')} now. Wait until the overview says all data is
              safe and fully replicated before stopping the daemons.
            </Notice>
          )}
          <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5, fontSize: 13.5, lineHeight: 1.55 }}>
            {plan.consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </Box>
          <Typography sx={{ fontSize: 13, mt: 1, mb: 0.5 }}>Cairn runs:</Typography>
          <CommandList cmds={plan.start.map(s => cliText(s.cmd))} />
        </Box>
        <Box>
          <Typography component="h3" sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>
            3. Do the work, then finish
          </Typography>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.55, mb: 0.5 }}>
            {node ? `Drain or reboot ${node} as needed (kubectl drain respects Rook’s PodDisruptionBudgets). ` : ''}When the OSDs are back up,
            finish with {host ? 'Finish maintenance on the host shelf, or run' : 'Clear noout, or run'}:
          </Typography>
          <CommandList cmds={plan.finish.map(s => cliText(s.cmd))} />
        </Box>
        {done && (
          <Notice tone="ok" title="Maintenance started">
            Ceph will not mark {what} out while it is down. Remember to finish when the work is done.
          </Notice>
        )}
        {err && (
          <Notice tone="err" title="A step failed">
            {err} The steps before it ran; see Activity.
          </Notice>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={busy}>
          {done ? 'Close' : 'Cancel'}
        </Button>
        {!done && (
          <Button onClick={start} variant="contained" color={markOutToo ? 'error' : 'primary'} disabled={busy}>
            {markOutToo ? 'Start maintenance and mark out' : 'Start maintenance'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Finishing a host's maintenance: the reverse steps (mark in if out, unset noout on the host). */
export async function finishHostMaintenance(ns: string, host: string, osds: Osd[], refresh: () => void) {
  const out = osds.filter(o => !o.in);
  const plan = maintenancePlan({ osds: out.map(o => o.id), host, markOut: out.length > 0 });
  const ok = await confirm({
    title: `Finish maintenance of ${host}?`,
    body: <CommandList cmds={plan.finish.map(s => cliText(s.cmd))} />,
    consequences: [
      ...(out.length ? [`${names(out)} ${out.length === 1 ? 'is' : 'are'} marked in again: data moves back onto ${out.length === 1 ? 'it' : 'them'}.`] : []),
      `Ceph again marks the OSDs of ${host} out when they stay down for 10 minutes.`,
      ...(osds.some(o => !o.up) ? ['Some of its OSDs are still down: their placement groups stay degraded until they are up.'] : []),
    ],
    confirm: 'Finish maintenance',
  });
  if (!ok) return;
  await cephSteps(ns, plan.finish, `host ${host}`, refresh, 'osds.nodeflags');
}
