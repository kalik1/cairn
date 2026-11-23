/*
 * RBD dialogs: create an image, grow it, take a snapshot, clone one, and
 * (for images the CSI driver owns) take a Kubernetes VolumeSnapshot of
 * the claim instead. Each runs one operation and stays open with Ceph's
 * message when it fails.
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
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';
import { rbdOps,RbdWhere } from '../../api/rbdOps';
import { bytes, parseSize } from '../../model/format';
import {
  CREATE_FEATURES,
  DEFAULT_FEATURES,
  FEATURES,
  imageSpec,
  nameProblem,
  RbdImage,
  snapNameNow,
  toggleFeature,
  volumeSnapshotFor,
} from '../../model/rbd';
import { Obj, Pool } from '../../model/types';
import { previewChange } from '../../ui/ChangeDialog';
import { openDialog } from '../../ui/dialogs';
import { Mono, Notice } from '../../ui/kit';

/**
 * A dialog with one action. `submit` throws to keep it open with the
 * message, or returns false to keep it open quietly.
 */
function FormDialog({
  title,
  children,
  action,
  disabled,
  danger,
  submit,
  onClose,
  wide,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  action: string;
  disabled?: boolean;
  danger?: boolean;
  submit: () => Promise<void | boolean>;
  onClose: () => void;
  wide?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if ((await submit()) === false) setBusy(false);
      else onClose();
    } catch (e) {
      setError((e as Error).message || String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth={wide ? 'md' : 'sm'} fullWidth aria-labelledby="cairn-rbd-dialog-title">
      <DialogTitle id="cairn-rbd-dialog-title" sx={{ fontSize: 18 }}>
        {title}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {children}
        {error && (
          <Notice tone="err" title="Ceph refused">
            {error}
          </Notice>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={danger ? 'error' : 'primary'}
          onClick={go}
          disabled={busy || disabled}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* --------------------------------------------------------- create */

export function openCreateImage(w: RbdWhere, taken: string[], dataPools: Pool[], onDone: (name: string) => void) {
  openDialog(close => <CreateImage w={w} taken={taken} dataPools={dataPools} onDone={onDone} onClose={close} />);
}

function CreateImage({ w, taken, dataPools, onDone, onClose }: { w: RbdWhere; taken: string[]; dataPools: Pool[]; onDone: (n: string) => void; onClose: () => void }) {
  const [name, setName] = React.useState('');
  const [size, setSize] = React.useState('10G');
  const [feats, setFeats] = React.useState<string[]>(DEFAULT_FEATURES);
  const [dataPool, setDataPool] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const nameErr = nameProblem(name, taken);
  const bytesN = parseSize(size);
  const sizeErr = bytesN === null ? 'Write a size like 10G, 512M or 1.5T.' : bytesN < 1024 * 1024 ? 'At least 1M.' : null;
  return (
    <FormDialog
      title={`Create image in ${w.ns ? `${w.pool}/${w.ns}` : w.pool}`}
      action="Create image"
      disabled={!!nameErr || !!sizeErr}
      onClose={onClose}
      submit={async () => {
        await rbdOps.create(w, name.trim(), bytesN!, feats, dataPool || undefined);
        onDone(name.trim());
      }}
    >
      <TextField
        size="small"
        label="Name"
        value={name}
        onChange={e => {
          setName(e.target.value);
          setTouched(true);
        }}
        error={touched && !!nameErr}
        helperText={(touched && nameErr) || 'Letters, digits, dots, dashes and underscores.'}
        inputProps={{ spellCheck: false, autoComplete: 'off' }}
      />
      <TextField
        size="small"
        label="Size"
        value={size}
        onChange={e => setSize(e.target.value)}
        error={!!sizeErr}
        helperText={sizeErr ?? `${bytes(bytesN)}, thin provisioned: space is used only as data is written.`}
      />
      <Box>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.5 }}>Features</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
          {CREATE_FEATURES.map(f => (
            <FormControlLabel
              key={f}
              sx={{ alignItems: 'flex-start', m: 0, py: 0.25 }}
              control={<Checkbox size="small" sx={{ mt: -0.5 }} checked={feats.includes(f)} onChange={e => setFeats(toggleFeature(feats, f, e.target.checked))} />}
              label={
                <Box>
                  <Mono>{f}</Mono>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{FEATURES.find(x => x.name === f)?.about}</Typography>
                </Box>
              }
            />
          ))}
        </Box>
      </Box>
      {dataPools.length > 0 && (
        <TextField
          select
          size="small"
          label="Data pool"
          value={dataPool}
          onChange={e => setDataPool(e.target.value)}
          helperText="Keep the image's data in an erasure-coded pool; its metadata stays here."
        >
          <MenuItem value="">None: data stays in {w.pool}</MenuItem>
          {dataPools.map(p => (
            <MenuItem key={p.name} value={p.name}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
      )}
    </FormDialog>
  );
}

/* ----------------------------------------------------------- grow */

export function openGrow(w: RbdWhere, img: RbdImage, note?: string) {
  openDialog(close => <Grow w={w} img={img} note={note} onClose={close} />);
}

function Grow({ w, img, note, onClose }: { w: RbdWhere; img: RbdImage; note?: string; onClose: () => void }) {
  const [size, setSize] = React.useState(bytes(img.size * 2).replace(/\.0+ /, ' ').replace(' ', '').replace('iB', ''));
  const n = parseSize(size);
  const err = n === null ? 'Write a size like 20G.' : n <= img.size ? `Larger than the current ${bytes(img.size)}.` : null;
  return (
    <FormDialog
      title={
        <>
          Grow <Mono>{img.name}</Mono>
        </>
      }
      action="Grow image"
      disabled={!!err}
      onClose={onClose}
      submit={async () => {
        await rbdOps.grow(w, img.name, n!);
      }}
    >
      <Typography sx={{ fontSize: 14 }}>
        It is {bytes(img.size)} now. Shrinking is not offered here: it cuts off whatever is stored at the end of the image.
      </Typography>
      <TextField size="small" label="New size" value={size} onChange={e => setSize(e.target.value)} error={!!err} helperText={err ?? bytes(n)} />
      {note && <Notice tone="warn">{note}</Notice>}
    </FormDialog>
  );
}

/* ------------------------------------------------------- snapshot */

export function openSnapshot(w: RbdWhere, img: RbdImage, note?: string) {
  openDialog(close => <Snapshot w={w} img={img} note={note} onClose={close} />);
}

function Snapshot({ w, img, note, onClose }: { w: RbdWhere; img: RbdImage; note?: string; onClose: () => void }) {
  const [name, setName] = React.useState(snapNameNow());
  const err = nameProblem(name, img.snaps.map(s => s.name), 'snapshot');
  return (
    <FormDialog
      title={
        <>
          Snapshot <Mono>{img.name}</Mono>
        </>
      }
      action="Create snapshot"
      disabled={!!err}
      onClose={onClose}
      submit={async () => {
        await rbdOps.snapCreate(w, img.name, name.trim());
      }}
    >
      <TextField size="small" label="Snapshot name" value={name} onChange={e => setName(e.target.value)} error={!!err} helperText={err ?? 'A read-only point-in-time copy; it only uses space as the image changes.'} />
      {note && <Notice tone="warn">{note}</Notice>}
    </FormDialog>
  );
}

/* ---------------------------------------------------------- clone */

export function openClone(w: RbdWhere, img: RbdImage, snap: string, pools: Pool[], taken: string[], onDone: (pool: string, ns: string, name: string) => void) {
  openDialog(close => <Clone w={w} img={img} snap={snap} pools={pools} taken={taken} onDone={onDone} onClose={close} />);
}

function Clone({
  w,
  img,
  snap,
  pools,
  taken,
  onDone,
  onClose,
}: {
  w: RbdWhere;
  img: RbdImage;
  snap: string;
  pools: Pool[];
  taken: string[];
  onDone: (pool: string, ns: string, name: string) => void;
  onClose: () => void;
}) {
  const [pool, setPool] = React.useState(w.pool);
  const [ns, setNs] = React.useState(w.ns);
  const [name, setName] = React.useState(`${img.name}-clone`);
  const err = nameProblem(name, pool === w.pool && ns === w.ns ? taken : []);
  return (
    <FormDialog
      title={
        <>
          Clone <Mono>{`${img.name}@${snap}`}</Mono>
        </>
      }
      action="Create clone"
      disabled={!!err}
      onClose={onClose}
      submit={async () => {
        await rbdOps.clone(w, img.name, snap, { pool, ns: ns.trim(), name: name.trim() });
        onDone(pool, ns.trim(), name.trim());
      }}
    >
      <Typography sx={{ fontSize: 14 }}>
        The clone is a new writable image that shares every unchanged block with the snapshot. While it exists the snapshot cannot be
        unprotected or deleted; flatten the clone to cut the link.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField select size="small" label="Pool" value={pool} onChange={e => setPool(e.target.value)} sx={{ flex: '1 1 180px' }}>
          {pools.map(p => (
            <MenuItem key={p.name} value={p.name}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField size="small" label="RADOS namespace" placeholder="Default" value={ns} onChange={e => setNs(e.target.value)} sx={{ flex: '1 1 160px' }} />
      </Box>
      <TextField size="small" label="Name of the clone" value={name} onChange={e => setName(e.target.value)} error={!!err} helperText={err ?? imageSpec(pool, ns.trim(), name.trim())} />
    </FormDialog>
  );
}

/* ------------------------------------------------ VolumeSnapshot */

export function openVolumeSnapshot(pvc: Obj, pv: Obj | undefined, classes: Obj[]) {
  openDialog(close => <VolSnap pvc={pvc} pv={pv} classes={classes} onClose={close} />);
}

const K8S_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

function VolSnap({ pvc, pv, classes, onClose }: { pvc: Obj; pv?: Obj; classes: Obj[]; onClose: () => void }) {
  const driver = pv?.spec?.csi?.driver;
  const fit = classes.filter(c => !driver || c.driver === driver);
  const def = fit.find(c => c.metadata.annotations?.['snapshot.storage.kubernetes.io/is-default-class'] === 'true') ?? fit[0];
  const [cls, setCls] = React.useState(def?.metadata.name ?? '');
  const stamp = snapNameNow().slice(5);
  const [name, setName] = React.useState(`${pvc.metadata.name.slice(0, 62 - stamp.length).replace(/-+$/, '')}-${stamp}`);
  const err = !K8S_NAME.test(name) || name.length > 253 ? 'Lowercase letters, digits and dashes.' : null;
  return (
    <FormDialog
      title={
        <>
          VolumeSnapshot of <Mono>{`${pvc.metadata.namespace}/${pvc.metadata.name}`}</Mono>
        </>
      }
      action="Review"
      disabled={!!err || !cls}
      onClose={onClose}
      submit={async () => {
        const ok = await previewChange({
          title: `Snapshot claim ${pvc.metadata.namespace}/${pvc.metadata.name}`,
          op: 'create',
          after: volumeSnapshotFor(pvc, cls, name),
          consequences: [
            'The CSI driver takes the snapshot in Ceph and records it as a VolumeSnapshotContent.',
            'Kubernetes keeps track of it: restore it as a new claim (dataSource), delete it with the VolumeSnapshot.',
            'The volume stays in use; the snapshot is crash-consistent unless the application is quiesced.',
          ],
          action: 'Create VolumeSnapshot',
          target: `pvc ${pvc.metadata.namespace}/${pvc.metadata.name}`,
        });
        return ok;
      }}
    >
      <Typography sx={{ fontSize: 14 }}>
        The CSI driver owns this image, so its snapshots go through Kubernetes: they are listed with the claim, restorable as new volumes, and
        do not block the volume’s deletion.
      </Typography>
      {fit.length ? (
        <TextField select size="small" label="Snapshot class" value={cls} onChange={e => setCls(e.target.value)} helperText={driver ? `Classes of ${driver}` : undefined}>
          {fit.map(c => (
            <MenuItem key={c.metadata.name} value={c.metadata.name}>
              {c.metadata.name} (deletion policy {c.deletionPolicy ?? 'Delete'})
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Notice tone="warn" title="No VolumeSnapshotClass for this driver">
          Create a VolumeSnapshotClass for {driver ?? 'the Ceph RBD CSI driver'} first (Kubernetes view).
        </Notice>
      )}
      <TextField size="small" label="Name" value={name} onChange={e => setName(e.target.value)} error={!!err} helperText={err ?? `In namespace ${pvc.metadata.namespace}`} />
    </FormDialog>
  );
}
