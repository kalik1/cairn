/*
 * Dialogs opened from anywhere (tree, tables, faceplate): a module-level
 * stack rendered by <DialogHost/> in the shell. `confirm()` covers the
 * common case, including "type the name to delete" and a list of
 * consequences, and the information-only dialog (why an action cannot run
 * now, and what to do).
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';

type Render = (close: () => void) => React.ReactNode;

let stack: { id: number; render: Render }[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

/** Opens a dialog; `render` gets `close`. Returns a function that closes it. */
export function openDialog(render: Render): () => void {
  const id = ++seq;
  const close = () => {
    stack = stack.filter(d => d.id !== id);
    emit();
  };
  stack = [...stack, { id, render: () => render(close) }];
  emit();
  return close;
}

export function DialogHost() {
  const items = React.useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => stack
  );
  return (
    <>
      {items.map(d => (
        <React.Fragment key={d.id}>{d.render(() => undefined)}</React.Fragment>
      ))}
    </>
  );
}

/** The button of an information-only dialog when `confirm` gives none. */
export const INFO_CLOSE = 'Close';

interface ConfirmCommon {
  title: string;
  body?: React.ReactNode;
  danger?: boolean;
  /** The user must type this to enable the button. */
  typeToConfirm?: string;
  /** One line each, shown as a list: what will happen, or (information only) what stands in the way. */
  consequences?: React.ReactNode[];
  /** A last line under the list, such as what to do first. */
  footer?: React.ReactNode;
  /** Optional checkbox, its value is returned. */
  option?: { label: string; help?: string; initial?: boolean };
}

export type ConfirmOptions = ConfirmCommon &
  (
    | { confirm: string; infoOnly?: false }
    /** Information only: one button (the `confirm` label, default INFO_CLOSE), resolves null. */
    | { confirm?: string; infoOnly: true }
  );

/** Resolves to null when cancelled (an information-only dialog always), else { option } (the checkbox value). */
export function confirm(o: ConfirmOptions): Promise<{ option: boolean } | null> {
  return new Promise(resolve => {
    openDialog(close => (
      <ConfirmDialog
        o={o}
        onClose={r => {
          close();
          resolve(r);
        }}
      />
    ));
  });
}

function ConfirmDialog({ o, onClose }: { o: ConfirmOptions; onClose: (r: { option: boolean } | null) => void }) {
  const [typed, setTyped] = React.useState('');
  const [opt, setOpt] = React.useState(!!o.option?.initial);
  const ok = !o.typeToConfirm || typed === o.typeToConfirm;
  return (
    <Dialog open onClose={() => onClose(null)} maxWidth="sm" fullWidth aria-labelledby="cairn-confirm-title">
      <DialogTitle id="cairn-confirm-title" sx={{ fontSize: 18 }}>
        {o.title}
      </DialogTitle>
      <DialogContent>
        {o.body && <Box sx={{ fontSize: 14, lineHeight: 1.55, '& p': { m: 0, mb: 1 } }}>{o.body}</Box>}
        {o.consequences && o.consequences.length > 0 && (
          <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5, fontSize: 13.5, lineHeight: 1.55, '& li': { mb: 0.5 } }}>
            {o.consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </Box>
        )}
        {o.footer && <Box sx={{ mt: 1.5, fontSize: 13.5, lineHeight: 1.55 }}>{o.footer}</Box>}
        {o.option && (
          <FormControlLabel
            sx={{ mt: 1, alignItems: 'flex-start' }}
            control={<Checkbox checked={opt} onChange={e => setOpt(e.target.checked)} sx={{ mt: -0.75 }} />}
            label={
              <Box>
                <Typography sx={{ fontSize: 14 }}>{o.option.label}</Typography>
                {o.option.help && (
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{o.option.help}</Typography>
                )}
              </Box>
            }
          />
        )}
        {o.typeToConfirm && (
          <TextField
           
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            label={`Type ${o.typeToConfirm} to confirm`}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && ok) onClose({ option: opt });
            }}
          />
        )}
      </DialogContent>
      <DialogActions>
        {!o.infoOnly && (
          <Button onClick={() => onClose(null)} color="inherit">
            Cancel
          </Button>
        )}
        <Button
          onClick={() => onClose(o.infoOnly ? null : { option: opt })}
          disabled={!ok}
          variant="contained"
          color={o.danger ? 'error' : 'primary'}
         
        >
          {o.confirm ?? INFO_CLOSE}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
