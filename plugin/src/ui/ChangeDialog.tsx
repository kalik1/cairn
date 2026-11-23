/*
 * The change preview: what will change in Kubernetes, as a YAML diff of
 * the object before and after, with what it means for the cluster, a
 * server-side dry run ("Validate") and Apply. Used for every write to a
 * Rook resource, StorageClass or snapshot class, so the operator, not
 * Cairn, makes the change in Ceph.
 */

import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import yaml from 'js-yaml';
import React from 'react';
import { runOp } from '../api/activity';
import { applyChange, ChangeOp } from '../api/apply';
import { errorText } from '../api/client';
import { cleanForDiff, diffLines, withContext } from '../model/diff';
import { Obj } from '../model/types';
import { openDialog } from './dialogs';
import { Notice } from './kit';
import { STATE } from './tokens';
import { useTokens } from './useTokens';

export interface ChangeOptions {
  title: string;
  op: ChangeOp;
  /** The object as it is (update, delete). */
  before?: Obj | null;
  /** The object as it will be (create, update). */
  after?: Obj | null;
  /** What it means for the cluster, one line each. */
  consequences?: React.ReactNode[];
  /** Shown as a warning above the diff. */
  warning?: React.ReactNode;
  /** Requires typing this (e.g. the pool name) before Apply. */
  typeToConfirm?: string;
  /** Label of the apply button ("Create pool", "Delete"). */
  action?: string;
  danger?: boolean;
  /** For the activity log. */
  target?: string;
  /** Who acts on the change, under the diff (default: from the kind). */
  note?: React.ReactNode;
  /** Called after a successful apply. */
  onDone?: (result: unknown) => void;
}

/** Who turns the Kubernetes object into storage, in words. */
export function actorNote(o: { apiVersion?: string; kind?: string } | null | undefined): string {
  const g = (o?.apiVersion ?? '').split('/')[0];
  if (g === 'ceph.rook.io') return 'Rook applies it to Ceph.';
  if (g === 'objectbucket.io') return "Rook's bucket provisioner creates or removes the bucket.";
  if (g === 'snapshot.storage.k8s.io') return 'The CSI driver takes or removes the Ceph snapshot.';
  if (g === 'storage.k8s.io') return 'The CSI driver uses it for new volumes; existing volumes keep what they were made with.';
  if (g === 'csi.ceph.io') return 'The Ceph-CSI operator applies it to the CSI drivers.';
  return 'Kubernetes stores it.';
}

const toYaml = (o: Obj | null | undefined) => (o ? yaml.dump(cleanForDiff(o), { noRefs: true, lineWidth: 120 }) : '');

/** Opens the preview; resolves true when applied, false when cancelled. */
export function previewChange(o: ChangeOptions): Promise<boolean> {
  return new Promise(resolve => {
    openDialog(close => (
      <ChangeDialog
        o={o}
        onClose={ok => {
          close();
          resolve(ok);
        }}
      />
    ));
  });
}

function ChangeDialog({ o, onClose }: { o: ChangeOptions; onClose: (ok: boolean) => void }) {
  const t = useTokens();
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState<'validate' | 'apply' | null>(null);
  const [check, setCheck] = React.useState<{ ok: boolean; text: string } | null>(null);
  const subject = (o.op === 'delete' ? o.before : o.after) as Obj;
  const lines = React.useMemo(() => {
    const before = o.op === 'create' ? '' : toYaml(o.before);
    const after = o.op === 'delete' ? '' : toYaml(o.after);
    const d = diffLines(before, after);
    return o.op === 'update' ? withContext(d, 4) : d;
  }, [o]);
  const typedOk = !o.typeToConfirm || typed === o.typeToConfirm;
  const verb = o.op === 'create' ? 'Create' : o.op === 'delete' ? 'Delete' : 'Apply';
  const what = `${subject?.kind ?? 'object'} ${subject?.metadata?.namespace ? `${subject.metadata.namespace}/` : ''}${subject?.metadata?.name ?? ''}`;

  const validate = async () => {
    setBusy('validate');
    setCheck(null);
    try {
      await applyChange(o.op, subject, true, o.before);
      setCheck({ ok: true, text: 'The API server accepted the change (dry run: nothing was stored).' });
    } catch (e) {
      setCheck({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    setBusy('apply');
    setCheck(null);
    try {
      let result: unknown;
      await runOp({
        title: o.title,
        target: o.target ?? what,
        detail: `${o.op} ${what}`,
        run: async () => {
          result = await applyChange(o.op, subject, false, o.before);
          return o.op === 'delete' ? 'Deleted' : o.op === 'create' ? 'Created' : 'Updated';
        },
      });
      o.onDone?.(result);
      onClose(true);
    } catch (e) {
      setCheck({ ok: false, text: (e as Error).message });
      setBusy(null);
    }
  };

  return (
    <Dialog open onClose={() => !busy && onClose(false)} maxWidth="md" fullWidth aria-labelledby="cairn-change-title">
      <DialogTitle id="cairn-change-title" sx={{ fontSize: 18 }}>
        {o.title}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {o.warning && <Notice tone={o.danger ? 'err' : 'warn'}>{o.warning}</Notice>}
        {o.consequences && o.consequences.length > 0 && (
          <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 14, lineHeight: 1.55, '& li': { mb: 0.5 } }}>
            {o.consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </Box>
        )}
        <Box sx={{ fontSize: 13, color: t.muted }}>
          {verb} {what} in Kubernetes. {o.note ?? actorNote(subject)}
        </Box>
        <Box
          component="pre"
          aria-label="Change as YAML"
          sx={{
            m: 0,
            p: 1.25,
            maxHeight: 360,
            overflow: 'auto',
            fontFamily: t.font.mono,
            fontSize: 12.5,
            lineHeight: 1.5,
            background: t.sunken,
            border: `1px solid ${t.rule}`,
            borderRadius: `${t.radius.small}px`,
          }}
        >
          {lines.map((l, i) => (
            <Box
              key={i}
              component="div"
              sx={{
                whiteSpace: 'pre',
                px: 0.5,
                color: l.kind === 'gap' ? t.muted : undefined,
                fontStyle: l.kind === 'gap' ? 'italic' : undefined,
                background: l.kind === 'add' ? `${STATE.ok}22` : l.kind === 'del' ? `${STATE.err}22` : undefined,
              }}
            >
              {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : l.kind === 'gap' ? '  … ' : '  '}
              {l.text}
            </Box>
          ))}
        </Box>
        {check && (
          <Notice tone={check.ok ? 'ok' : 'err'} title={check.ok ? 'Valid' : 'Refused'}>
            {check.text}
          </Notice>
        )}
        {o.typeToConfirm && (
          <TextField
            size="small"
            label={`Type ${o.typeToConfirm} to confirm`}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            autoComplete="off"
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)} color="inherit" disabled={!!busy}>
          Cancel
        </Button>
        <Button
          onClick={validate}
          disabled={!!busy}
          startIcon={busy === 'validate' ? <CircularProgress size={14} /> : <Icon icon="mdi:check-decagram-outline" width={16} />}
        >
          Validate
        </Button>
        <Button
          onClick={apply}
          disabled={!!busy || !typedOk}
          variant="contained"
          color={o.danger ? 'error' : 'primary'}
          startIcon={busy === 'apply' ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {o.action ?? verb}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
