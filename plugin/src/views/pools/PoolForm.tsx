/*
 * Create or change a pool through its CephBlockPool. Creating is a
 * three-step wizard (name and protection, placement, limits and tuning)
 * with what the pool will cost always in view; changing shows the same
 * fields on one page. Both end in the change preview (YAML diff, dry run,
 * apply), so Rook makes the change in Ceph.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Step from '@mui/material/Step';
import StepButton from '@mui/material/StepButton';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { previewCreatePool, previewEditPool } from '../../api/poolOps';
import { bytes, plural } from '../../model/format';
import {
  blockPoolName,
  createImpact,
  defaultPoolForm,
  domainTypes,
  editImpact,
  formFromCr,
  Line,
  parseQuantity,
  PoolForm,
  poolProblems,
  Problem,
  rawFactorOf,
} from '../../model/pools';
import { Obj, Pool } from '../../model/types';
import { openDialog } from '../../ui/dialogs';
import { Notice } from '../../ui/kit';
import { Mark } from '../../ui/Mark';
import { tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';
import { useFormContext } from './common';

type Mode = { mode: 'create'; onCreated?: (name: string) => void } | { mode: 'edit'; cr: Obj; pool?: Pool };

export function openPoolForm(m: Mode) {
  openDialog(close => <PoolFormDialog m={m} onClose={close} />);
}

const STEPS: { label: string; fields: (keyof PoolForm)[] }[] = [
  { label: 'Name and protection', fields: ['name', 'type', 'size', 'k', 'm'] },
  { label: 'Placement', fields: ['failureDomain', 'deviceClass'] },
  { label: 'Limits and tuning', fields: ['compression', 'compressionAlgorithm', 'quotaMaxSize', 'quotaMaxObjects', 'application', 'targetSizeRatio', 'autoscale', 'rbdStats'] },
];

const COMPRESSION: Record<string, string> = {
  none: 'Never compress.',
  passive: 'Compress only when the client hints that data is compressible.',
  aggressive: 'Compress unless the client hints that data is incompressible (a good choice for most data).',
  force: 'Always try to compress.',
};

function PoolFormDialog({ m, onClose }: { m: Mode; onClose: () => void }) {
  const t = useTokens();
  const k = useKube();
  const c = useCeph();
  const edit = m.mode === 'edit';
  const before = React.useMemo(() => (m.mode === 'edit' ? formFromCr(m.cr) : undefined), [m]);
  const [f, setF] = React.useState<PoolForm>(() => before ?? defaultPoolForm());
  const [step, setStep] = React.useState(0);
  const [touched, setTouched] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const ctx = useFormContext(f.deviceClass);
  const crs = k.blockPools.items.filter(p => p.metadata.namespace === k.ns).map(p => p.metadata.name);
  const cephPools = edit ? ctx.form.cephPools.filter(n => n !== blockPoolName((m as any).cr)) : ctx.form.cephPools;
  const problems = poolProblems(f, { ...ctx.form, crs: edit ? [] : crs, cephPools }, m.mode, before);
  const errors = problems.filter(p => p.level === 'error');
  const set = <K extends keyof PoolForm>(key: K, v: PoolForm[K]) => {
    setF(x => ({ ...x, [key]: v }));
    setTouched(s => new Set(s).add(key));
  };
  const show = (key: keyof PoolForm) => touched.has(key) || (key !== 'name' && touched.size > 0) || key === 'failureDomain';
  const problemOf = (key: keyof PoolForm): Problem | undefined => (show(key) ? problems.find(p => p.field === key) : undefined);
  const help = (key: keyof PoolForm, fallback?: React.ReactNode) => {
    const p = problemOf(key);
    return { error: p?.level === 'error', helperText: p ? p.text : fallback };
  };
  const lines: Line[] = edit
    ? editImpact(before!, f, m.mode === 'edit' && m.pool?.usage ? { stored: m.pool.usage.stored, objects: m.pool.usage.objects } : undefined).lines
    : createImpact(f, ctx.impact).lines;
  const fdTypes = domainTypes(ctx.impact.domains);
  const classes = ctx.form.deviceClasses;
  const osdsOf = (cls: string) => c.core.osds.filter(o => o.in && (!cls || o.deviceClass === cls)).length;
  const stepErrors = (i: number) => errors.some(e => STEPS[i].fields.includes(e.field as keyof PoolForm));

  const review = async () => {
    setTouched(new Set(['name', 'size', 'k', 'm', 'failureDomain', 'deviceClass', 'quotaMaxSize', 'quotaMaxObjects', 'targetSizeRatio', 'application']));
    if (errors.length) {
      if (!edit) setStep(STEPS.findIndex((_, i) => stepErrors(i)));
      return;
    }
    setBusy(true);
    try {
      const ok =
        m.mode === 'edit'
          ? await previewEditPool(m.cr, before!, f, m.pool)
          : await previewCreatePool(f, k.ns, lines, undefined);
      if (ok) {
        onClose();
        c.refresh();
        if (m.mode === 'create') m.onCreated?.(f.name.trim());
      }
    } finally {
      setBusy(false);
    }
  };

  const name = (
    <TextField
      label="Name"
      size="small"
      value={f.name}
      disabled={edit}
      onChange={e => set('name', e.target.value)}
      {...help('name', 'Lowercase letters, digits and dashes. The Ceph pool and the CephBlockPool get this name.')}
      inputProps={{ spellCheck: false, autoComplete: 'off' }}
      fullWidth
    />
  );
  const protection = (
    <>
      <Box>
        <FieldLabel>Data protection</FieldLabel>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={f.type}
          onChange={(_, v) => v && set('type', v)}
          disabled={edit}
          aria-label="Data protection"
        >
          <ToggleButton value="replicated" sx={{ textTransform: 'none', px: 2 }}>
            Replicated
          </ToggleButton>
          <ToggleButton value="erasure" sx={{ textTransform: 'none', px: 2 }}>
            Erasure coded
          </ToggleButton>
        </ToggleButtonGroup>
        {problemOf('type') && <Hint tone="err">{problemOf('type')!.text}</Hint>}
      </Box>
      {f.type === 'replicated' ? (
        <TextField
          select
          size="small"
          label="Copies"
          value={f.size}
          onChange={e => set('size', Number(e.target.value))}
          {...help('size', `Ceph keeps ${f.size} copies and accepts writes while ${f.size - Math.floor(f.size / 2)} are available (min_size).`)}
          sx={{ maxWidth: 420 }}
        >
          {[1, 2, 3, 4, 5].map(n => (
            <MenuItem key={n} value={n}>
              {plural(n, 'copy', 'copies')}
              {n === 3 ? ' (recommended)' : n === 1 ? ' (no redundancy)' : ''}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              type="number"
              label="Data chunks (k)"
              value={f.k}
              disabled={edit}
              onChange={e => set('k', Math.round(Number(e.target.value)))}
              inputProps={{ min: 2, max: 16 }}
              {...help('k')}
              sx={{ width: 180 }}
            />
            <TextField
              size="small"
              type="number"
              label="Coding chunks (m)"
              value={f.m}
              disabled={edit}
              onChange={e => set('m', Math.round(Number(e.target.value)))}
              inputProps={{ min: 1, max: 8 }}
              {...help('m')}
              sx={{ width: 180 }}
            />
          </Box>
          <Notice tone="idle" title="RBD on an erasure-coded pool">
            Block images keep their data here but their metadata (headers, object maps) in a replicated pool. In the StorageClass, set{' '}
            <code>pool</code> to a replicated pool and <code>dataPool</code> to this one. Each object is cut into {f.k} data and {f.m} coding
            chunks on {f.k + f.m} different {f.failureDomain === 'osd' ? 'OSDs' : `${f.failureDomain}s`}.
          </Notice>
        </>
      )}
    </>
  );
  const placement = (
    <>
      <TextField
        select
        size="small"
        label="Failure domain"
        value={f.failureDomain}
        disabled={edit && f.type === 'erasure'}
        onChange={e => set('failureDomain', e.target.value)}
        {...help(
          'failureDomain',
          `No two ${f.type === 'replicated' ? 'copies' : 'chunks'} of an object share a ${f.failureDomain}: the pool survives losing ${
            f.type === 'replicated' ? f.size - 1 : f.m
          } of them.`
        )}
        sx={{ maxWidth: 420 }}
      >
        {fdTypes.map(d => (
          <MenuItem key={d} value={d}>
            {d} ({ctx.impact.domains[d] ?? 0} available)
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="Device class"
        value={f.deviceClass}
        disabled={edit && f.type === 'erasure'}
        onChange={e => set('deviceClass', e.target.value)}
        {...help('deviceClass', 'Keep the pool on one kind of disk (hdd, ssd, nvme), or let it use any OSD.')}
        sx={{ maxWidth: 420 }}
      >
        <MenuItem value="">Any ({plural(osdsOf(''), 'OSD')})</MenuItem>
        {classes.map(cl => (
          <MenuItem key={cl} value={cl}>
            {cl} ({plural(osdsOf(cl), 'OSD')})
          </MenuItem>
        ))}
      </TextField>
      {edit && f.type === 'erasure' && <Hint tone="idle">The placement of an erasure-coded pool comes from its profile and is fixed.</Hint>}
    </>
  );
  const tuning = (
    <>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Compression"
          value={f.compression}
          onChange={e => set('compression', e.target.value as PoolForm['compression'])}
          helperText={COMPRESSION[f.compression]}
          sx={{ flex: '1 1 240px' }}
        >
          {Object.keys(COMPRESSION).map(x => (
            <MenuItem key={x} value={x}>
              {x}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Algorithm"
          value={f.compressionAlgorithm}
          disabled={f.compression === 'none'}
          onChange={e => set('compressionAlgorithm', e.target.value)}
          helperText="Ceph's default is snappy."
          sx={{ flex: '1 1 160px' }}
        >
          <MenuItem value="">Default</MenuItem>
          {['snappy', 'zstd', 'lz4', 'zlib'].map(x => (
            <MenuItem key={x} value={x}>
              {x}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          label="Size quota"
          placeholder="No quota"
          value={f.quotaMaxSize}
          onChange={e => set('quotaMaxSize', e.target.value.trim())}
          {...help(
            'quotaMaxSize',
            parseQuantity(f.quotaMaxSize) ? `Writes stop at ${bytes(parseQuantity(f.quotaMaxSize))} stored.` : 'Like 100Gi or 2Ti; empty for none.'
          )}
          inputProps={{ spellCheck: false, autoComplete: 'off' }}
          sx={{ flex: '1 1 200px' }}
        />
        <TextField
          size="small"
          label="Object quota"
          placeholder="No quota"
          value={f.quotaMaxObjects}
          onChange={e => set('quotaMaxObjects', e.target.value.trim())}
          {...help('quotaMaxObjects', 'Most objects the pool may hold; empty for none.')}
          inputProps={{ inputMode: 'numeric', autoComplete: 'off' }}
          sx={{ flex: '1 1 200px' }}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <TextField
          size="small"
          label="Target size ratio"
          placeholder="None"
          value={f.targetSizeRatio}
          onChange={e => set('targetSizeRatio', e.target.value.trim())}
          {...help('targetSizeRatio', 'The share of the cluster you expect it to fill (0.2 = a fifth): PGs are sized ahead of the data.')}
          sx={{ flex: '1 1 240px' }}
        />
        <Box sx={{ flex: '1 1 200px' }}>
          <FieldLabel>PG autoscaler</FieldLabel>
          <ToggleButtonGroup size="small" exclusive value={f.autoscale} onChange={(_, v) => v && set('autoscale', v)} aria-label="PG autoscaler">
            {(['on', 'warn', 'off'] as const).map(v => (
              <ToggleButton key={v} value={v} sx={{ textTransform: 'none', px: 1.75 }}>
                {v}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography sx={{ fontSize: 12, color: t.muted, mt: 0.5 }}>
            {f.autoscale === 'on' ? 'Ceph changes pg_num as the pool grows.' : f.autoscale === 'warn' ? 'Ceph only raises a health warning.' : 'pg_num stays as it is.'}
          </Typography>
        </Box>
      </Box>
      <TextField
        select
        size="small"
        label="Application"
        value={['rbd', 'rgw', 'cephfs'].includes(f.application) ? f.application : 'other'}
        onChange={e => set('application', e.target.value === 'other' ? '' : e.target.value)}
        {...help('application', 'rbd for block images (Rook’s default); rgw only for pools shared by object stores.')}
        sx={{ maxWidth: 420 }}
      >
        <MenuItem value="rbd">rbd (block images)</MenuItem>
        <MenuItem value="rgw">rgw (shared object store pool)</MenuItem>
        <MenuItem value="other">Other…</MenuItem>
      </TextField>
      {!['rbd', 'rgw', 'cephfs'].includes(f.application) && (
        <TextField size="small" label="Application name" value={f.application} onChange={e => set('application', e.target.value.trim())} sx={{ maxWidth: 420 }} />
      )}
      <FormControlLabel
        control={<Checkbox size="small" checked={f.rbdStats} onChange={e => set('rbdStats', e.target.checked)} />}
        label={<Box sx={{ fontSize: 14 }}>Collect per-image I/O statistics (enableRBDStats)</Box>}
      />
      <Typography sx={{ fontSize: 13, color: t.muted }}>Mirroring stays off; turn it on later in the CephBlockPool (spec.mirroring).</Typography>
    </>
  );
  const sections = [
    <>
      {name}
      {protection}
    </>,
    placement,
    tuning,
  ];
  const raw = rawFactorOf(f);

  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="lg" fullWidth aria-labelledby="cairn-pool-form-title">
      <DialogTitle id="cairn-pool-form-title" sx={{ fontSize: 18 }}>
        {edit ? `Change pool ${f.name}` : 'Create pool'}
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px' }, gap: 3, alignItems: 'start' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, pt: 1 }}>
          {!edit && (
            <Stepper nonLinear activeStep={step} sx={{ mb: 1 }}>
              {STEPS.map((s, i) => (
                <Step key={s.label} completed={false}>
                  <StepButton onClick={() => setStep(i)} optional={stepErrors(i) && touched.size > 0 ? <Hint tone="err">Needs attention</Hint> : undefined}>
                    {s.label}
                  </StepButton>
                </Step>
              ))}
            </Stepper>
          )}
          {edit
            ? sections.map((s, i) => (
                <Box key={i} component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography component="h3" sx={{ fontSize: 15, fontWeight: 600 }}>
                    {STEPS[i].label}
                  </Typography>
                  {s}
                </Box>
              ))
            : sections[step]}
        </Box>
        <Box
          component="aside"
          aria-label="What this does"
          sx={{ border: `1px solid ${t.rule}`, borderRadius: `${t.radius.panel}px`, p: 2, background: t.sunken, display: 'flex', flexDirection: 'column', gap: 1.25 }}
        >
          <Typography component="h3" sx={{ fontSize: 15, fontWeight: 600 }}>
            {edit ? 'What the change does' : 'What this pool costs'}
          </Typography>
          {!edit && (
            <Box sx={{ display: 'flex', gap: 3, ...tabular }}>
              <Box>
                <Box sx={{ fontSize: 20, fontWeight: 600 }}>{Number.isInteger(raw) ? raw : raw.toFixed(2)}×</Box>
                <Box sx={{ fontSize: 12.5, color: t.muted }}>raw per stored byte</Box>
              </Box>
              <Box>
                <Box sx={{ fontSize: 20, fontWeight: 600 }}>{bytes(createImpact(f, ctx.impact).usable)}</Box>
                <Box sx={{ fontSize: 12.5, color: t.muted }}>room for data now</Box>
              </Box>
            </Box>
          )}
          {lines.length === 0 && <Typography sx={{ fontSize: 13.5, color: t.muted }}>Nothing changes yet.</Typography>}
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}>
            {lines.map((l, i) => (
              <Box component="li" key={i} sx={{ display: 'flex', gap: 1, fontSize: 13.5, lineHeight: 1.45 }}>
                <Box sx={{ pt: '5px' }}>
                  {l.tone === 'idle' ? (
                    <Box component="span" aria-hidden sx={{ display: 'block', width: 8, height: 8, borderRadius: '50%', background: t.muted, opacity: 0.6 }} />
                  ) : (
                    <Mark tone={l.tone} size={8} />
                  )}
                </Box>
                <span>{l.text}</span>
              </Box>
            ))}
          </Box>
          {touched.size > 0 && errors.length > 0 && (
            <Notice tone="err" title={errors.length === 1 ? 'One thing to fix' : `${errors.length} things to fix`}>
              {errors.map(e => (
                <p key={e.field + e.text}>{e.text}</p>
              ))}
            </Notice>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={busy}>
          Cancel
        </Button>
        {!edit && step > 0 && (
          <Button onClick={() => setStep(s => s - 1)} disabled={busy}>
            Back
          </Button>
        )}
        {!edit && step < STEPS.length - 1 ? (
          <Button
            variant="contained"
            onClick={() => {
              setTouched(s => new Set([...s, ...STEPS[step].fields]));
              if (!stepErrors(step)) setStep(s => s + 1);
            }}
          >
            Next
          </Button>
        ) : (
          <Button variant="contained" onClick={review} disabled={busy}>
            Review change
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const t = useTokens();
  return <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.5 }}>{children}</Typography>;
}

function Hint({ tone, children }: { tone: 'err' | 'idle'; children: React.ReactNode }) {
  return (
    <Typography component="span" sx={{ display: 'block', fontSize: 12, color: tone === 'err' ? 'error.main' : 'text.secondary', mt: 0.5 }}>
      {children}
    </Typography>
  );
}
