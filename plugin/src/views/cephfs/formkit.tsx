/*
 * Small pieces shared by the File, Object and Security views: a form
 * dialog that hands its object to the change preview, fields, a "why not"
 * dialog, and pod / condition lists for Rook resources.
 */

import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { conditions, phaseTone } from '../../model/cephfs';
import { Obj } from '../../model/types';
import { openDialog } from '../../ui/dialogs';
import { Mono, Notice, When } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';

/* ---------------------------------------------------------------- form */

export function FormDialog({
  title,
  intro,
  children,
  onClose,
  onSubmit,
  submitLabel = 'Review change',
  error,
  wide,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  /** Validates and opens the change preview. */
  onSubmit: () => void;
  submitLabel?: string;
  error?: string | null;
  wide?: boolean;
}) {
  const t = useTokens();
  const id = React.useId();
  return (
    <Dialog open onClose={onClose} maxWidth={wide ? 'md' : 'sm'} fullWidth aria-labelledby={id}>
      <DialogTitle id={id} sx={{ fontSize: 18 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <Box
          component="form"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            onSubmit();
          }}
          sx={{ display: 'grid', gap: 2, pt: 0.5 }}
        >
          {intro && <Typography sx={{ fontSize: 14, color: t.muted, lineHeight: 1.55 }}>{intro}</Typography>}
          {children}
          {error && <Notice tone="err">{error}</Notice>}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={onSubmit} variant="contained" startIcon={<Icon icon="mdi:file-compare" width={16} />}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Two or three fields side by side (stacked on narrow screens). */
export function Row({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: `repeat(${cols}, minmax(0, 1fr))` }, alignItems: 'start' }}>{children}</Box>;
}

export function Field({
  label,
  value,
  onChange,
  problem,
  help,
  unit,
  placeholder,
  mono,
  inputMode,
  name,
}: {
  label: string;
  /** Input name (and id): stable selectors for tests and autofill hints. */
  name?: string;
  value: string;
  onChange: (v: string) => void;
  problem?: string | null;
  help?: React.ReactNode;
  unit?: string;
  placeholder?: string;
  mono?: boolean;
  inputMode?: 'numeric' | 'decimal' | 'text';
}) {
  const t = useTokens();
  return (
    <TextField
      label={label}
      id={name ? `cairn-${name}` : undefined}
      size="small"
      fullWidth
      value={value}
      onChange={e => onChange(e.target.value)}
      error={!!problem}
      helperText={problem || help || ' '}
      placeholder={placeholder}
      autoComplete="off"
      inputProps={{ name, inputMode, spellCheck: false, style: mono ? { fontFamily: t.font.mono, fontSize: 13.5 } : undefined }}
      InputProps={unit ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment> } : undefined}
    />
  );
}

export function NumField({
  label,
  value,
  onChange,
  problem,
  help,
  unit,
  name,
}: {
  label: string;
  name?: string;
  value: number;
  onChange: (v: number) => void;
  problem?: string | null;
  help?: React.ReactNode;
  unit?: string;
}) {
  const [txt, setTxt] = React.useState(String(value));
  React.useEffect(() => {
    if (Number(txt) !== value) setTxt(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Field
      label={label}
      name={name}
      value={txt}
      inputMode="numeric"
      unit={unit}
      problem={problem}
      help={help}
      onChange={v => {
        setTxt(v);
        const n = Number(v);
        onChange(v.trim() === '' || !isFinite(n) ? NaN : Math.round(n));
      }}
    />
  );
}

export function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
  problem,
  help,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  problem?: string | null;
  help?: React.ReactNode;
}) {
  return (
    <TextField
      select
      label={label}
      size="small"
      fullWidth
      value={value}
      onChange={e => onChange(e.target.value as T)}
      error={!!problem}
      helperText={problem || help || ' '}
      InputLabelProps={{ shrink: true }}
      SelectProps={{ displayEmpty: true }}
    >
      {options.map(o => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function Check({
  label,
  help,
  checked,
  onChange,
  name,
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  name?: string;
}) {
  const t = useTokens();
  return (
    <FormControlLabel
      sx={{ alignItems: 'flex-start', m: 0, gap: 0.5 }}
      control={<Checkbox size="small" checked={checked} onChange={e => onChange(e.target.checked)} inputProps={{ name } as any} sx={{ mt: -0.75, ml: -1 }} />}
      label={
        <Box>
          <Typography sx={{ fontSize: 14 }}>{label}</Typography>
          {help && <Typography sx={{ fontSize: 12.5, color: t.muted, lineHeight: 1.45 }}>{help}</Typography>}
        </Box>
      }
    />
  );
}

/** A sub-heading inside a form. */
export function FormSection({ children }: { children: React.ReactNode }) {
  const t = useTokens();
  return <Typography sx={{ fontSize: 13.5, fontWeight: 600, mt: 0.5, pt: 1.5, borderTop: `1px solid ${t.rule}` }}>{children}</Typography>;
}

/** Hosts with OSDs, for the replica checks (3 when not known yet). */
export function useOsdHosts(): number {
  const c = useCeph();
  const n = c.core.hosts.filter(h => h.osds.length > 0).length;
  return n || 3;
}

/** Opens a form dialog; the render gets `close`. */
export function openForm(render: (close: () => void) => React.ReactNode) {
  return openDialog(render);
}

/* --------------------------------------------------- pods, conditions */

const podReady = (p: Obj) =>
  p.status?.phase === 'Running' && !p.metadata.deletionTimestamp && (p.status?.containerStatuses ?? []).every((c: any) => c.ready);

export function podState(p: Obj): { tone: 'ok' | 'warn' | 'err' | 'move' | 'idle'; word: string } {
  if (p.metadata.deletionTimestamp) return { tone: 'move', word: 'Stopping' };
  const waiting = (p.status?.containerStatuses ?? []).map((c: any) => c.state?.waiting?.reason).find(Boolean);
  if (waiting) return { tone: /CrashLoop|Err|BackOff/.test(waiting) ? 'err' : 'move', word: waiting };
  if (podReady(p)) return { tone: 'ok', word: 'Running' };
  if (p.status?.phase === 'Pending') return { tone: 'move', word: 'Pending' };
  if (p.status?.phase === 'Failed') return { tone: 'err', word: 'Failed' };
  return { tone: 'warn', word: p.status?.phase === 'Running' ? 'Not ready' : p.status?.phase ?? 'Unknown' };
}

const podRestarts = (p: Obj) => (p.status?.containerStatuses ?? []).reduce((n: number, c: any) => n + (c.restartCount ?? 0), 0);

export function PodList({ pods, empty }: { pods: Obj[]; empty: React.ReactNode }) {
  const t = useTokens();
  if (!pods.length) return <Box sx={{ color: t.muted, fontSize: 13.5 }}>{empty}</Box>;
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}>
      {[...pods]
        .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
        .map(p => {
          const s = podState(p);
          const r = podRestarts(p);
          return (
            <Box component="li" key={p.metadata.name} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 1, fontSize: 13.5, alignItems: 'baseline' }}>
              <Box sx={{ minWidth: 0 }}>
                <Mono>{p.metadata.name}</Mono>
                <Box sx={{ color: t.muted, fontSize: 12.5 }}>
                  {p.spec?.nodeName ?? 'not scheduled'}
                  {r ? `, ${r} restart${r === 1 ? '' : 's'}` : ''}, started <When at={p.status?.startTime ?? p.metadata.creationTimestamp} />
                </Box>
              </Box>
              <StateLabel tone={s.tone} size="sm">
                {s.word}
              </StateLabel>
            </Box>
          );
        })}
    </Box>
  );
}

export function PhaseLabel({ phase, missing = 'No status yet' }: { phase?: string; missing?: string }) {
  return <StateLabel tone={phase ? phaseTone(phase) : 'idle'}>{phase || missing}</StateLabel>;
}

export function Conditions({ cr }: { cr: Obj }) {
  const t = useTokens();
  const cs = conditions(cr);
  const msg = cr.status?.message;
  if (!cs.length && !msg) return <Box sx={{ color: t.muted, fontSize: 13.5 }}>Rook has not reported conditions yet.</Box>;
  return (
    <Box sx={{ display: 'grid', gap: 0.75, fontSize: 13.5 }}>
      {msg && !cs.some(c => c.message === msg) && <Box>{msg}</Box>}
      {cs.map((c, i) => (
        <Box key={i} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <StateLabel tone={c.status === 'True' ? (/fail|error/i.test(c.type + c.reason) ? 'err' : 'ok') : 'idle'} size="sm">
              {c.type}
            </StateLabel>
            {(c.message || c.reason) && <Box sx={{ color: t.muted, fontSize: 12.5, mt: 0.25 }}>{c.message || c.reason}</Box>}
          </Box>
          <Box sx={{ color: t.muted, fontSize: 12.5 }}>
            <When at={c.at} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** An external documentation link. */
export function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecorationColor: 'currentColor', textUnderlineOffset: 2, display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
      {children}
      <Icon icon="mdi:open-in-new" width={13} aria-hidden />
    </Box>
  );
}
