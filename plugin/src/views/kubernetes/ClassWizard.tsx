/*
 * The StorageClass wizard: pick what the class is for (VM disks,
 * filesystem volumes, a shared filesystem), then where the data goes and
 * how claims behave. Driver, clusterID and CSI secret names are learned
 * from the cluster and shown under "Driver and secrets". Review opens the
 * change preview of the class (and of its snapshot class); cancelling it
 * comes back here with the same form.
 */

import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';
import { createClassFlow } from '../../api/k8sOps';
import {
  buildSnapshotClass,
  buildStorageClass,
  ClassForm,
  defaultForm,
  fsDataPools,
  presetAvailability,
  presetById,
  PresetId,
  PRESETS,
  validateClassForm,
  WizardContext,
} from '../../model/storageclass';
import { Pool } from '../../model/types';
import { openDialog } from '../../ui/dialogs';
import { Mono, Notice } from '../../ui/kit';
import { useTokens } from '../../ui/useTokens';

export interface WizardExtra {
  /** Live Ceph pools (to describe them and offer RBD pools Rook does not manage). */
  cephPools: Pool[];
}

/** Opens the wizard; loops back to it when the change preview is cancelled. */
export async function runClassWizard(ctx: WizardContext, extra: WizardExtra, onChanged?: (created: unknown) => void, start?: { preset?: PresetId; pool?: string }) {
  let form: ClassForm | null = start?.preset ? defaultForm(ctx, start.preset, { pool: start.pool }) : null;
  for (;;) {
    const res = await new Promise<ClassForm | null>(resolve =>
      openDialog(close => (
        <WizardDialog
          ctx={ctx}
          extra={extra}
          initial={form}
          startPool={start?.pool}
          onClose={f => {
            close();
            resolve(f);
          }}
        />
      ))
    );
    if (!res) return;
    form = res;
    const r = await createClassFlow(buildStorageClass(res), buildSnapshotClass(res), res, ctx, onChanged);
    if (r === 'done') return;
  }
}

function WizardDialog({
  ctx,
  extra,
  initial,
  startPool,
  onClose,
}: {
  ctx: WizardContext;
  extra: WizardExtra;
  initial: ClassForm | null;
  startPool?: string;
  onClose: (f: ClassForm | null) => void;
}) {
  const [form, setForm] = React.useState<ClassForm | null>(initial);
  const [advanced, setAdvanced] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const choose = (id: PresetId) => setForm(defaultForm(ctx, id, { pool: startPool }));
  const errors = form ? validateClassForm(form, ctx) : {};
  const nErr = Object.keys(errors).length;
  const set = (p: Partial<ClassForm>) => setForm(f => (f ? { ...f, ...p } : f));
  return (
    <Dialog open onClose={() => onClose(null)} maxWidth="md" fullWidth aria-labelledby="cairn-sc-wizard-title" scroll="paper">
      <DialogTitle id="cairn-sc-wizard-title" sx={{ fontSize: 18, pb: 0.5 }}>
        {form ? `New StorageClass: ${presetById(form.preset).title.toLowerCase()}` : 'New StorageClass'}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {!form ? (
          <PresetStep ctx={ctx} onChoose={choose} />
        ) : (
          <DetailsStep
            ctx={ctx}
            extra={extra}
            form={form}
            set={set}
            errors={touched ? errors : pickVisible(errors, form)}
            advanced={advanced || (touched && !!(errors.provisioner || errors.clusterID || errors.imageFeatures || errors.secrets))}
            setAdvanced={setAdvanced}
          />
        )}
      </DialogContent>
      <DialogActions>
        {form && (
          <Button color="inherit" onClick={() => setForm(null)} startIcon={<Icon icon="mdi:chevron-left" width={18} />}>
            Other presets
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button color="inherit" onClick={() => onClose(null)}>
          Cancel
        </Button>
        {form && (
          <Button
            variant="contained"
            onClick={() => {
              setTouched(true);
              if (!nErr) onClose(form);
            }}
          >
            Review
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Errors worth showing before the first Review: names that clash, impossible choices. */
function pickVisible(e: Record<string, string>, f: ClassForm): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['name', 'snapshotName', 'imageFeatures']) if (e[k] && !(k === 'name' && !f.name)) out[k] = e[k];
  return out;
}

function PresetStep({ ctx, onChoose }: { ctx: WizardContext; onChoose: (id: PresetId) => void }) {
  const t = useTokens();
  return (
    <>
      <Typography sx={{ fontSize: 14, color: t.muted }}>What will the volumes of this class hold? The preset fills the rest; you can change it.</Typography>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
        {PRESETS.map(p => {
          const av = presetAvailability(ctx, p.id);
          return (
            <Box
              key={p.id}
              component="button"
              type="button"
              disabled={!av.ok}
              onClick={() => av.ok && onChoose(p.id)}
              aria-describedby={`preset-${p.id}-summary`}
              sx={{
                all: 'unset',
                boxSizing: 'border-box',
                cursor: av.ok ? 'pointer' : 'not-allowed',
                border: `1px solid ${t.rule}`,
                borderRadius: `${t.radius.panel}px`,
                p: 1.75,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                opacity: av.ok ? 1 : 0.75,
                background: t.surface,
                '&:hover': av.ok ? { background: t.hover, borderColor: t.meterUsed } : undefined,
                '&:focus-visible': { outline: `2px solid ${t.meterUsed}`, outlineOffset: 2 },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icon icon={p.id === 'vm' ? 'mdi:monitor' : p.id === 'fs' ? 'mdi:folder-outline' : 'mdi:folder-network-outline'} width={20} style={{ color: t.muted }} />
                <Box component="span" sx={{ fontWeight: 600, fontSize: 15 }}>
                  {p.title}
                </Box>
              </Box>
              <Box component="span" id={`preset-${p.id}-summary`} sx={{ fontSize: 13.5, lineHeight: 1.5 }}>
                {p.summary}
              </Box>
              <Box component="span" sx={{ fontSize: 12.5, color: t.muted }}>
                {p.kind === 'rbd' ? 'RBD' : 'CephFS'}, {p.accessModes.join(', ')}, volumeMode {p.volumeMode}
              </Box>
              {!av.ok && (
                <Box component="span" sx={{ fontSize: 12.5, mt: 0.5, color: t.text, borderLeft: `3px solid ${t.rule}`, pl: 1 }}>
                  {av.reason}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </>
  );
}

function poolWords(name: string, ctx: WizardContext, cephPools: Pool[]): string {
  const cr = ctx.blockPools.find(p => p.metadata.name === name);
  const live = cephPools.find(p => p.name === name);
  const parts: string[] = [];
  if (cr?.spec?.replicated?.size) parts.push(`${cr.spec.replicated.size} replicas`);
  else if (cr?.spec?.erasureCoded) parts.push(`erasure coded ${cr.spec.erasureCoded.dataChunks}+${cr.spec.erasureCoded.codingChunks}`);
  else if (live) parts.push(live.type === 'erasure' ? `erasure coded ${live.ec?.k}+${live.ec?.m}` : `${live.size} replicas`);
  if (cr?.spec?.failureDomain) parts.push(`across ${cr.spec.failureDomain}s`);
  if (cr?.spec?.deviceClass) parts.push(`${cr.spec.deviceClass} devices`);
  if (!cr) parts.push('not a CephBlockPool');
  return parts.join(', ');
}

function DetailsStep({
  ctx,
  extra,
  form,
  set,
  errors,
  advanced,
  setAdvanced,
}: {
  ctx: WizardContext;
  extra: WizardExtra;
  form: ClassForm;
  set: (p: Partial<ClassForm>) => void;
  errors: Record<string, string>;
  advanced: boolean;
  setAdvanced: (b: boolean) => void;
}) {
  const t = useTokens();
  const p = presetById(form.preset);
  const crPools = ctx.blockPools.filter(b => !b.metadata.namespace || b.metadata.namespace === ctx.ns).map(b => b.metadata.name);
  const livePools = extra.cephPools.filter(x => x.applications.includes('rbd') && !crPools.includes(x.name)).map(x => x.name);
  const pools = [...crPools, ...livePools];
  const fs = ctx.filesystems.find(f => f.metadata.name === form.fsName);
  const field = { size: 'small' as const, fullWidth: true };
  const snapSet = (s: Partial<ClassForm['snapshot']>) => set({ snapshot: { ...form.snapshot, ...s } });
  const existingSnap = ctx.snapshotClasses.filter(v => v.driver === form.provisioner).map(v => v.metadata.name);
  return (
    <>
      <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 13.5, lineHeight: 1.55, color: t.text }}>
        {p.details.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <TextField
          {...field}
          label="Name"
          value={form.name}
          onChange={e => {
            const name = e.target.value.trim();
            set({ name, snapshot: { ...form.snapshot, name: form.snapshot.name === `${form.name}-snapshot` ? `${name}-snapshot` : form.snapshot.name } });
          }}
          error={!!errors.name}
          helperText={errors.name ?? 'Claims name it in storageClassName.'}
          inputProps={{ name: 'sc-name', autoComplete: 'off', spellCheck: false }}
        />
        {p.kind === 'rbd' ? (
          <TextField
            {...field}
            select
            label="Pool"
            value={pools.includes(form.pool) ? form.pool : ''}
            onChange={e => set({ pool: e.target.value, description: form.description.replace(/pool \S+/, `pool ${e.target.value}`) })}
            error={!!errors.pool}
            helperText={errors.pool ?? (form.pool ? poolWords(form.pool, ctx, extra.cephPools) : 'Where the RBD images go.')}
            inputProps={{ name: 'sc-pool' }}
            SelectProps={{ MenuProps: { disableScrollLock: true }, renderValue: v => <Mono>{String(v)}</Mono> }}
          >
            {pools.map(n => (
              <MenuItem key={n} value={n}>
                <Box>
                  <Mono>{n}</Mono>
                  <Box component="span" sx={{ ml: 1, fontSize: 12.5, color: t.muted }}>
                    {poolWords(n, ctx, extra.cephPools)}
                  </Box>
                </Box>
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <TextField
            {...field}
            select
            label="Filesystem"
            value={form.fsName}
            onChange={e => set({ fsName: e.target.value, pool: '' })}
            error={!!errors.fsName}
            helperText={errors.fsName ?? 'The CephFilesystem the subvolumes go to.'}
            inputProps={{ name: 'sc-fs' }}
            SelectProps={{ MenuProps: { disableScrollLock: true } }}
          >
            {ctx.filesystems.map(f => (
              <MenuItem key={f.metadata.name} value={f.metadata.name}>
                <Mono>{f.metadata.name}</Mono>
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          {...field}
          label="Description"
          value={form.description}
          onChange={e => set({ description: e.target.value })}
          helperText="Shown by Kubernetes tools (the description annotation)."
          inputProps={{ name: 'sc-description' }}
        />
        {p.kind === 'cephfs' ? (
          <TextField
            {...field}
            select
            label="Data pool"
            value={form.pool}
            onChange={e => set({ pool: e.target.value })}
            helperText="Leave on the filesystem's default unless it has several data pools."
            SelectProps={{ displayEmpty: true, MenuProps: { disableScrollLock: true } }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">The filesystem’s default</MenuItem>
            {(fs ? fsDataPools(fs) : []).map(n => (
              <MenuItem key={n} value={n}>
                <Mono>{n}</Mono>
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Box>
            <Typography sx={{ fontSize: 12.5, color: t.muted, mb: 0.25 }}>Filesystem, for volumeMode Filesystem claims</Typography>
            <RadioGroup row value={form.fstype} onChange={e => set({ fstype: e.target.value as ClassForm['fstype'] })} aria-label="Filesystem type">
              <FormControlLabel value="ext4" control={<Radio size="small" />} label="ext4" />
              <FormControlLabel value="xfs" control={<Radio size="small" />} label="xfs" />
            </RadioGroup>
            {form.preset === 'vm' && <Typography sx={{ fontSize: 12.5, color: t.muted }}>VM disks are Block volumes: the CSI driver does not format them.</Typography>}
          </Box>
        )}
        <TextField
          {...field}
          select
          label="When a claim is deleted"
          value={form.reclaimPolicy}
          onChange={e => set({ reclaimPolicy: e.target.value as ClassForm['reclaimPolicy'] })}
          helperText="Reclaim policy of the volumes."
          SelectProps={{ MenuProps: { disableScrollLock: true } }}
        >
          <MenuItem value="Delete">Delete the data in Ceph (Delete)</MenuItem>
          <MenuItem value="Retain">Keep the data in Ceph (Retain)</MenuItem>
        </TextField>
        <TextField
          {...field}
          select
          label="When the volume is made"
          value={form.bindingMode}
          onChange={e => set({ bindingMode: e.target.value as ClassForm['bindingMode'] })}
          helperText={
            form.bindingMode === 'Immediate'
              ? 'At once: CDI imports and clones can start before a VM runs.'
              : 'When a pod first uses it: the scheduler places the pod first.'
          }
          SelectProps={{ MenuProps: { disableScrollLock: true } }}
        >
          <MenuItem value="Immediate">As soon as it is claimed (Immediate)</MenuItem>
          <MenuItem value="WaitForFirstConsumer">When a pod uses it (WaitForFirstConsumer)</MenuItem>
        </TextField>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <FormControlLabel
            control={<Switch size="small" checked={form.allowExpansion} onChange={e => set({ allowExpansion: e.target.checked })} />}
            label="Claims can grow (allow volume expansion)"
          />
          <FormControlLabel
            control={<Switch size="small" checked={form.makeDefault} onChange={e => set({ makeDefault: e.target.checked })} />}
            label="Default class for claims that name none"
          />
        </Box>
      </Box>

      <Box sx={{ borderTop: `1px solid ${t.rule}`, pt: 1.5 }}>
        <FormControlLabel
          control={<Checkbox size="small" checked={form.snapshot.create} onChange={e => snapSet({ create: e.target.checked })} inputProps={{ name: 'vsc-create' } as any} />}
          label="Also create a VolumeSnapshotClass for this driver"
        />
        {!form.snapshot.create && existingSnap.length > 0 && (
          <Typography sx={{ fontSize: 12.5, color: t.muted, ml: 4 }}>
            {existingSnap.join(', ')} already snapshot{existingSnap.length === 1 ? 's' : ''} volumes of {form.provisioner}.
          </Typography>
        )}
        <Collapse in={form.snapshot.create} unmountOnExit>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, mt: 1 }}>
            <TextField
              {...field}
              label="Snapshot class name"
              value={form.snapshot.name}
              onChange={e => snapSet({ name: e.target.value.trim() })}
              error={!!errors.snapshotName}
              helperText={errors.snapshotName ?? 'VolumeSnapshots name it in volumeSnapshotClassName.'}
              inputProps={{ name: 'vsc-name', autoComplete: 'off', spellCheck: false }}
            />
            <TextField
              {...field}
              select
              label="When a VolumeSnapshot is deleted"
              value={form.snapshot.deletionPolicy}
              onChange={e => snapSet({ deletionPolicy: e.target.value as ClassForm['reclaimPolicy'] })}
              SelectProps={{ MenuProps: { disableScrollLock: true } }}
            >
              <MenuItem value="Delete">Delete the Ceph snapshot (Delete)</MenuItem>
              <MenuItem value="Retain">Keep the Ceph snapshot (Retain)</MenuItem>
            </TextField>
            <FormControlLabel
              control={<Switch size="small" checked={form.snapshot.makeDefault} onChange={e => snapSet({ makeDefault: e.target.checked })} />}
              label="Default snapshot class for this driver"
            />
          </Box>
        </Collapse>
      </Box>

      <Box sx={{ borderTop: `1px solid ${t.rule}`, pt: 1 }}>
        <Button
          color="inherit"
          size="small"
          onClick={() => setAdvanced(!advanced)}
          aria-expanded={advanced}
          startIcon={<Icon icon={advanced ? 'mdi:chevron-down' : 'mdi:chevron-right'} width={18} />}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Driver and secrets
        </Button>
        <Typography component="span" sx={{ fontSize: 12.5, color: t.muted, ml: 1 }}>
          <Mono>{form.provisioner}</Mono>, clusterID <Mono>{form.clusterID}</Mono>,{' '}
          {form.learnedFrom ? (
            <>
              secrets as in <Mono>{form.learnedFrom}</Mono>
            </>
          ) : (
            'Rook’s default secret names'
          )}
        </Typography>
        <Collapse in={advanced}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1.5 }}>
            {form.driverSource === 'guess' && (
              <Notice tone="warn" title="No Ceph CSI driver found">
                No {p.kind === 'rbd' ? 'RBD' : 'CephFS'} driver is visible (Driver CR, CSIDriver or StorageClass): the name below is Rook’s usual one. Claims stay
                Pending until that driver runs.
              </Notice>
            )}
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              <TextField
                {...field}
                label="Provisioner (CSI driver)"
                value={form.provisioner}
                onChange={e => set({ provisioner: e.target.value.trim() })}
                error={!!errors.provisioner}
                helperText={errors.provisioner ?? (form.driverSource === 'driver' ? 'From the ceph-csi Driver.' : form.driverSource === 'class' ? 'As existing classes use it.' : ' ')}
                inputProps={{ spellCheck: false }}
              />
              <TextField
                {...field}
                label="clusterID"
                value={form.clusterID}
                onChange={e => set({ clusterID: e.target.value.trim() })}
                error={!!errors.clusterID}
                helperText={errors.clusterID ?? 'With Rook: the namespace of the CephCluster.'}
                inputProps={{ spellCheck: false }}
              />
              {p.kind === 'rbd' && (
                <>
                  <TextField
                    {...field}
                    label="Image features"
                    value={form.imageFeatures}
                    onChange={e => set({ imageFeatures: e.target.value.replace(/\s+/g, '') })}
                    error={!!errors.imageFeatures}
                    helperText={errors.imageFeatures ?? 'Comma separated. The kernel client must support each one.'}
                    inputProps={{ spellCheck: false }}
                  />
                  <TextField
                    {...field}
                    label="Map options"
                    value={form.mapOptions}
                    onChange={e => set({ mapOptions: e.target.value.trim() })}
                    helperText="krbd map options (krbd:rxbounce for VM disks)."
                    inputProps={{ spellCheck: false }}
                  />
                </>
              )}
            </Box>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.75 }}>CSI secrets (names only; Cairn never reads them)</Typography>
              {errors.secrets && <Typography sx={{ fontSize: 12.5, color: 'error.main', mb: 0.5 }}>{errors.secrets}</Typography>}
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                {Object.entries(form.secrets).map(([k, v]) => (
                  <TextField
                    key={k}
                    size="small"
                    label={k.replace('csi.storage.k8s.io/', '')}
                    value={v}
                    onChange={e => set({ secrets: { ...form.secrets, [k]: e.target.value.trim() } })}
                    inputProps={{ spellCheck: false }}
                  />
                ))}
              </Box>
            </Box>
          </Box>
        </Collapse>
      </Box>
    </>
  );
}
