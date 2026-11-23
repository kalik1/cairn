/*
 * Setting and removing a Ceph option. Two steps in one dialog: what (who,
 * option, value, with the option's help and checks), then a review that
 * shows the exact command and the old and new value; the change runs from
 * the review and its errors stay in the dialog. Options the CephCluster
 * manages (spec.cephConfig) go to the change preview of the CephCluster
 * instead, so Rook keeps applying them.
 */

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';
import { mon } from '../../api/bridge';
import { out, useCeph, useCephQuery } from '../../api/ceph';
import { configRemove, configSet, latestCluster } from '../../api/configOps';
import { useKube } from '../../api/kube';
import { useCan } from '../../api/permissions';
import {
  configCommandText,
  ConfigHelp,
  displayValue,
  ManagedBy,
  managedBy,
  parseConfigHelp,
  ROOK_DEFAULTS,
  rookManaged,
  sensitive,
  valueProblem,
  whoProblem,
  withCephConfig,
} from '../../model/config';
import { Obj } from '../../model/types';
import { previewChange } from '../../ui/ChangeDialog';
import { openDialog } from '../../ui/dialogs';
import { Mono, Notice } from '../../ui/kit';
import { useTokens } from '../../ui/useTokens';
import { Pre } from '../kubernetes/parts';

export interface CurrentValue {
  who: string;
  name: string;
  value: string;
}

/** The option's help, cached for ten minutes ("config help <name>"). */
export function useConfigHelp(name: string | null): { help: ConfigHelp | null; loading: boolean; missing: boolean; error: string | null } {
  const q = useCephQuery(`config.help.${name ?? ''}`, name ? [mon('config help', { key: name })] : null, { staleMs: 600000 });
  const res = q.data?.[0];
  return {
    help: parseConfigHelp(out(q.data)),
    loading: q.loading,
    missing: !!res && res.r === -2,
    error: res && res.r !== 0 && res.r !== -2 ? res.err || `error ${res.r}` : q.error,
  };
}

/** Who suggestions: the types, daemons Ceph knows, and whos already in the dump. */
function useWhoOptions(existing: string[]): string[] {
  const { core } = useCeph();
  const set = new Set(['global', 'mon', 'mgr', 'osd', 'mds', 'client', ...existing]);
  core.osds.forEach(o => set.add(`osd.${o.id}`));
  core.quorum?.mons.forEach(m => set.add(`mon.${m.name}`));
  if (core.mgr?.active) set.add(`mgr.${core.mgr.active}`);
  return [...set];
}

export function openSetDialog(o: { initial?: Partial<CurrentValue>; current: CurrentValue[]; cluster: Obj | null }) {
  openDialog(close => <SetDialog {...o} onClose={close} />);
}

export function openRemoveDialog(o: { entry: CurrentValue; cluster: Obj | null }) {
  openDialog(close => <RemoveDialog {...o} onClose={close} />);
}

function ValueChange({ before, after, help }: { before: string | null; after: string | null; help: ConfigHelp | null }) {
  const t = useTokens();
  const def = help ? `Ceph’s default${help.default !== '' ? ` (${help.default})` : ''}` : 'Ceph’s default';
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 0.75, fontSize: 13.5 }}>
      <Box sx={{ color: t.muted }}>Now</Box>
      <Box>{before === null ? <span>Not set: {def}</span> : <Mono>{before === '' ? "''" : before}</Mono>}</Box>
      <Box sx={{ color: t.muted }}>After</Box>
      <Box>{after === null ? <span>{def}</span> : <Mono>{after === '' ? "''" : after}</Mono>}</Box>
    </Box>
  );
}

const ROOK_UPDATE = { verb: 'update', group: 'ceph.rook.io', resource: 'cephclusters' };

function SetDialog({ initial, current, cluster, onClose }: { initial?: Partial<CurrentValue>; current: CurrentValue[]; cluster: Obj | null; onClose: () => void }) {
  const t = useTokens();
  const ceph = useCeph();
  const kube = useKube();
  const canRook = useCan({ ...ROOK_UPDATE, namespace: cluster?.metadata.namespace });
  const [who, setWho] = React.useState(initial?.who ?? '');
  const [name, setName] = React.useState(initial?.name ?? '');
  const [value, setValue] = React.useState(initial?.value !== undefined && !sensitive(initial?.name ?? '') ? initial.value : '');
  const [step, setStep] = React.useState<'edit' | 'review'>('edit');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const managed = React.useMemo(() => (cluster ? managedBy(rookMap(cluster), who.trim(), name.trim()) : undefined), [cluster, who, name]);
  const [where, setWhere] = React.useState<'ceph' | 'rook'>(managed?.by === 'spec' ? 'rook' : 'ceph');
  React.useEffect(() => {
    if (managed?.by === 'spec') setWhere('rook');
  }, [managed?.by]);
  const ls = useCephQuery('config.ls', [mon('config ls')], { staleMs: 600000 });
  const names: string[] = React.useMemo(() => (Array.isArray(out(ls.data)) ? (out(ls.data) as string[]) : []), [ls.data]);
  // "config ls" leaves out the debug_<subsystem> levels: ask "config help" for any plausible name.
  const trimmed = name.trim();
  const [settled, setSettled] = React.useState(trimmed);
  React.useEffect(() => {
    const id = window.setTimeout(() => setSettled(trimmed), 350);
    return () => window.clearTimeout(id);
  }, [trimmed]);
  const plausible = /^[a-z0-9_]{3,}$/.test(settled);
  const { help, loading: helpLoading, missing } = useConfigHelp(plausible ? settled : null);
  const known = names.includes(trimmed) || help?.name === trimmed;
  const whoOpts = useWhoOptions([...new Set(current.map(c => c.who))]);
  const now = current.find(c => c.who === who.trim() && c.name === name.trim()) ?? null;
  const shownNow = now ? displayValue(now.name, now.value) : null;

  const whoErr = whoProblem(who);
  const nameErr = !trimmed
    ? 'Choose an option.'
    : trimmed.includes('/') || known
    ? null
    : (missing && settled === trimmed) || !/^[a-z0-9_]+$/.test(trimmed)
    ? 'Ceph has no option with this name.'
    : null;
  const valErr = valueProblem(value, help);
  const bad = !!(whoErr || nameErr || valErr) || managed?.by === 'secret';
  const cephReason = ceph.phase !== 'ready' ? ceph.reason || 'Ceph commands cannot run now' : null;
  const rookReason = !cluster ? 'No CephCluster' : !canRook ? 'Your role may not change the CephCluster' : null;
  const cmd = configCommandText('set', who.trim(), name.trim(), value);
  const rookDefault = ROOK_DEFAULTS.find(d => d.who === who.trim() && d.name === name.trim());

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await configSet(ceph.ns, who.trim(), name.trim(), value);
      ceph.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const toRook = async () => {
    if (!cluster) return;
    const fresh = await latestCluster(cluster);
    onClose();
    previewChange({
      title: `Set ${name.trim()} for ${who.trim()} in the CephCluster`,
      op: 'update',
      before: fresh,
      after: withCephConfig(fresh, who.trim(), name.trim(), value),
      consequences: [
        `Rook runs ${cmd} at its next reconcile and sets it again whenever it differs.`,
        help && !help.runtime ? 'This option is read at start: the daemons use it after they restart.' : 'Daemons pick it up at once.',
      ],
      action: 'Apply to CephCluster',
      target: `cephcluster ${cluster.metadata.namespace}/${cluster.metadata.name}`,
      onDone: () => kube.refresh(),
    });
  };

  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="sm" fullWidth aria-labelledby="cairn-config-set-title">
      <DialogTitle id="cairn-config-set-title" sx={{ fontSize: 18 }}>
        {step === 'review' ? `Set ${name.trim()} for ${who.trim()}` : initial?.name ? `Change ${initial.name}` : 'Set a Ceph option'}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {step === 'edit' ? (
          <>
            <Autocomplete
              freeSolo
              options={whoOpts}
              inputValue={who}
              onInputChange={(_, v) => setWho(v)}
              disabled={!!initial?.who}
              renderInput={params => (
                <TextField
                  {...params}
                  size="small"
                  label="Who"
                  error={touched && !!whoErr}
                  helperText={(touched && whoErr) || 'global, a daemon type (osd), one daemon (osd.3), or osd/host:<node>.'}
                  inputProps={{ ...params.inputProps, name: 'cfg-who', spellCheck: false }}
                />
              )}
            />
            <Autocomplete
              freeSolo
              options={names}
              inputValue={name}
              onInputChange={(_, v) => setName(v.trim())}
              disabled={!!initial?.name}
              filterOptions={(opts, s) => {
                const w = s.inputValue.trim().toLowerCase().replace(/[\s-]+/g, '_');
                return (w ? opts.filter(o => o.includes(w)) : opts).slice(0, 80);
              }}
              renderInput={params => (
                <TextField
                  {...params}
                  size="small"
                  label="Option"
                  error={touched && !!nameErr}
                  helperText={(touched && nameErr) || (ls.loading ? 'Reading Ceph’s option list…' : `${names.length} options; type part of a name.`)}
                  inputProps={{ ...params.inputProps, name: 'cfg-name', spellCheck: false }}
                />
              )}
            />
            {help && (
              <Box sx={{ fontSize: 13, color: t.text, borderLeft: `3px solid ${t.rule}`, pl: 1.25 }}>
                <Box>{help.desc || 'No description.'}</Box>
                <Box sx={{ color: t.muted, mt: 0.25 }}>
                  {help.type}
                  {help.default !== '' ? `, default ${help.default}` : ''}
                  {help.min !== '' ? `, at least ${help.min}` : ''}
                  {help.max !== '' ? `, at most ${help.max}` : ''}
                  {help.runtime ? ', takes effect at once' : ', read when the daemon starts'}
                </Box>
              </Box>
            )}
            {helpLoading && plausible && <Typography sx={{ fontSize: 12.5, color: t.muted }}>Reading the option’s help…</Typography>}
            {help?.enumValues.length || help?.type === 'bool' ? (
              <TextField
                select
                size="small"
                label="Value"
                value={value}
                onChange={e => setValue(e.target.value)}
                error={touched && !!valErr}
                helperText={(touched && valErr) || ' '}
                inputProps={{ name: 'cfg-value' }}
                SelectProps={{ MenuProps: { disableScrollLock: true } }}
              >
                {(help.enumValues.length ? help.enumValues : ['true', 'false']).map(v => (
                  <MenuItem key={v} value={v}>
                    {v}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                size="small"
                label="Value"
                value={value}
                onChange={e => setValue(e.target.value)}
                error={touched && !!valErr}
                helperText={(touched && valErr) || (now && sensitive(now.name) ? 'The current value is hidden: it may hold a secret.' : ' ')}
                inputProps={{ name: 'cfg-value', spellCheck: false, autoComplete: 'off' }}
              />
            )}
            {managed?.by === 'secret' && (
              <Notice tone="warn" title="Set from a Secret by Rook">
                The CephCluster takes this option from the Secret {managed.secret} (cephConfigFromSecret). Change it there; Cairn does not read Secrets.
              </Notice>
            )}
            {rookDefault && (
              <Notice tone="warn" title="Rook sets this option itself">
                {rookDefault.why} Rook may set it back at its next reconcile.
              </Notice>
            )}
            {cluster && managed?.by !== 'secret' && (
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Where to keep it</Typography>
                <RadioGroup value={where} onChange={e => setWhere(e.target.value as 'ceph' | 'rook')} aria-label="Where to keep the option">
                  <FormControlLabel
                    value="ceph"
                    disabled={managed?.by === 'spec'}
                    control={<Radio size="small" />}
                    label={
                      <Box sx={{ fontSize: 13.5 }}>
                        Ceph’s configuration database (config set)
                        <Box sx={{ fontSize: 12.5, color: t.muted }}>
                          {managed?.by === 'spec' ? 'Not here: the CephCluster manages this option and Rook would set it back.' : 'At once; Rook does not know about it.'}
                        </Box>
                      </Box>
                    }
                  />
                  <FormControlLabel
                    value="rook"
                    control={<Radio size="small" />}
                    label={
                      <Box sx={{ fontSize: 13.5 }}>
                        The CephCluster (spec.cephConfig)
                        <Box sx={{ fontSize: 12.5, color: t.muted }}>Rook applies it and keeps it; it travels with the cluster’s YAML.</Box>
                      </Box>
                    }
                  />
                </RadioGroup>
              </Box>
            )}
          </>
        ) : (
          <>
            <Typography sx={{ fontSize: 14 }}>Cairn runs this command in the Rook {ceph.bridge?.status === 'ready' ? ceph.bridge.target.kind : 'pod'}:</Typography>
            <Pre label="Command">{cmd}</Pre>
            <ValueChange before={shownNow} after={value} help={help} />
            {help && !help.runtime && <Notice tone="warn">This option is read when a daemon starts: running daemons keep the old value until they restart.</Notice>}
            {err && (
              <Notice tone="err" title="Ceph refused the change">
                {err}
              </Notice>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {step === 'review' && (
          <Button color="inherit" onClick={() => setStep('edit')} disabled={busy}>
            Back
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button color="inherit" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {step === 'edit' ? (
          where === 'rook' && cluster ? (
            <Button variant="contained" disabled={!!rookReason} title={rookReason ?? undefined} onClick={() => (setTouched(true), !bad && toRook())}>
              Preview CephCluster change
            </Button>
          ) : (
            <Button variant="contained" disabled={!!cephReason} title={cephReason ?? undefined} onClick={() => (setTouched(true), !bad && setStep('review'))}>
              Review
            </Button>
          )
        ) : (
          <Button variant="contained" onClick={run} disabled={busy} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>
            Set value
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

const rookMapCache = new WeakMap<Obj, Map<string, ManagedBy>>();
function rookMap(cluster: Obj) {
  let m = rookMapCache.get(cluster);
  if (!m) {
    m = rookManaged(cluster);
    rookMapCache.set(cluster, m);
  }
  return m;
}

function RemoveDialog({ entry, cluster, onClose }: { entry: CurrentValue; cluster: Obj | null; onClose: () => void }) {
  const ceph = useCeph();
  const kube = useKube();
  const canRook = useCan({ ...ROOK_UPDATE, namespace: cluster?.metadata.namespace });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const { help } = useConfigHelp(entry.name.includes('/') ? null : entry.name);
  const managed = cluster ? managedBy(rookMap(cluster), entry.who, entry.name) : undefined;
  const cmd = configCommandText('rm', entry.who, entry.name);
  const cephReason = ceph.phase !== 'ready' ? ceph.reason || 'Ceph commands cannot run now' : null;
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await configRemove(ceph.ns, entry.who, entry.name);
      ceph.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const toRook = async () => {
    if (!cluster) return;
    const fresh = await latestCluster(cluster);
    onClose();
    previewChange({
      title: `Remove ${entry.name} for ${entry.who} from the CephCluster`,
      op: 'update',
      before: fresh,
      after: withCephConfig(fresh, entry.who, entry.name, null),
      consequences: [
        'Rook stops managing this option.',
        `The value stays in Ceph’s configuration database until it is removed there too (${cmd}).`,
      ],
      action: 'Apply to CephCluster',
      target: `cephcluster ${cluster.metadata.namespace}/${cluster.metadata.name}`,
      onDone: () => kube.refresh(),
    });
  };
  const viaRook = managed?.by === 'spec';
  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="sm" fullWidth aria-labelledby="cairn-config-rm-title">
      <DialogTitle id="cairn-config-rm-title" sx={{ fontSize: 18 }}>
        Remove {entry.name} for {entry.who}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {viaRook ? (
          <Notice tone="warn" title="The CephCluster manages this option">
            Removing it from Ceph alone would not last: Rook sets it again. Remove it from the CephCluster’s spec.cephConfig instead.
          </Notice>
        ) : managed?.by === 'secret' ? (
          <Notice tone="warn" title="Set from a Secret by Rook">
            The CephCluster takes this option from the Secret {managed.secret}. Remove it from cephConfigFromSecret.
          </Notice>
        ) : (
          <>
            <Typography sx={{ fontSize: 14 }}>The daemons go back to Ceph’s default. Cairn runs:</Typography>
            <Pre label="Command">{cmd}</Pre>
            {managed?.by === 'rook-default' && <Notice tone="warn">Rook sets this option itself and may set it again at its next reconcile.</Notice>}
          </>
        )}
        <ValueChange before={displayValue(entry.name, entry.value)} after={null} help={help} />
        {err && (
          <Notice tone="err" title="Ceph refused the change">
            {err}
          </Notice>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {viaRook ? (
          <Button variant="contained" color="error" onClick={toRook} disabled={!canRook} title={canRook ? undefined : 'Your role may not change the CephCluster'}>
            Preview CephCluster change
          </Button>
        ) : (
          <Button
            variant="contained"
            color="error"
            onClick={run}
            disabled={busy || !!cephReason || managed?.by === 'secret'}
            title={cephReason ?? undefined}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            Remove override
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
