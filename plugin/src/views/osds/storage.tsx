/*
 * The storage part of the CephCluster: how Rook picks disks today, and
 * the two changes Cairn prepares (a disk or node added, the device filter
 * changed), shown as a diff with what Rook will do, validated by the API
 * server before anything is applied.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { addNodeDevices, readStorage, setDeviceFilter, validateDevice } from '../../model/clusterSpec';
import { Obj } from '../../model/types';
import { previewChange } from '../../ui/ChangeDialog';
import { openDialog } from '../../ui/dialogs';
import { Action, KV, Mono, Notice, Panel, Tag } from '../../ui/kit';
import { useTokens } from '../../ui/useTokens';
import { fresh, Hint, useClusterEditReason } from '../overview/common';

export function StorageSpec() {
  const t = useTokens();
  const kube = useKube();
  const { core } = useCeph();
  const reason = useClusterEditReason();
  const cc = kube.cephCluster;
  const v = readStorage(cc);
  const osdNodes = [...new Set(core.osds.map(o => o.meta?.hostname).filter((x): x is string => !!x))];
  const devices = [...new Set(core.osds.flatMap(o => o.meta?.devices ?? []))];
  const nodeNames = kube.nodes.items.map(n => n.metadata.name).sort();
  const off = reason ?? (cc ? null : 'No CephCluster');
  return (
    <Panel
      title="Storage in the CephCluster"
      icon="mdi:harddisk-plus"
      id="storage"
      actions={
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Action icon="mdi:plus" onClick={() => cc && openAddStorage(cc, nodeNames, osdNodes)} reason={off}>
            Add a disk or node
          </Action>
          <Action onClick={() => cc && openFilter(cc, v.deviceFilter, devices)} reason={off}>
            Change the device filter
          </Action>
        </Box>
      }
    >
      <Typography sx={{ fontSize: 14, mb: 1.25 }}>{v.summary}</Typography>
      <KV
        labelWidth={170}
        rows={[
          ['Use all nodes', <Mono key="n">{String(v.useAllNodes)}</Mono>],
          ['Use all devices', <Mono key="d">{String(v.useAllDevices)}</Mono>],
          ['Device filter', v.deviceFilter ? <Mono key="f">{v.deviceFilter}</Mono> : 'none'],
          v.devicePathFilter && ['Device path filter', <Mono key="p">{v.devicePathFilter}</Mono>],
          [
            'Listed nodes',
            v.nodes.length ? (
              <Box key="nodes" component="ul" sx={{ m: 0, pl: 2 }}>
                {v.nodes.map(n => (
                  <li key={n.name}>
                    <Mono>{n.name}</Mono>
                    {n.devices.length > 0 && (
                      <>
                        {': '}
                        {n.devices.map(d => (
                          <Tag key={d.name ?? d.fullpath}>{d.name ?? d.fullpath}</Tag>
                        ))}
                      </>
                    )}
                    {n.deviceFilter && (
                      <>
                        {' '}
                        filter <Mono>{n.deviceFilter}</Mono>
                      </>
                    )}
                  </li>
                ))}
              </Box>
            ) : v.useAllNodes ? (
              'none (every node is used)'
            ) : (
              'none'
            ),
          ],
          v.deviceSets.length > 0 && ['Device sets on PVCs', v.deviceSets.map(d => `${d.name} (${d.count})`).join(', ')],
        ]}
      />
      <Hint sx={{ mt: 1.25, color: t.muted }}>
        Rook creates OSDs only on empty disks (no partitions, no filesystem) and never wipes a disk. Removing a disk from this list does not
        remove its OSD.
      </Hint>
    </Panel>
  );
}

/* ------------------------------------------------------- add storage */

function openAddStorage(cc: Obj, nodes: string[], osdNodes: string[]) {
  openDialog(close => <AddStorageDialog cc={cc} nodes={nodes} osdNodes={osdNodes} onClose={close} />);
}

function AddStorageDialog({ cc, nodes, osdNodes, onClose }: { cc: Obj; nodes: string[]; osdNodes: string[]; onClose: () => void }) {
  const [node, setNode] = React.useState(nodes.find(n => !osdNodes.includes(n)) ?? nodes[0] ?? '');
  const [text, setText] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const list = text
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const bad = list.map(d => [d, validateDevice(d)] as const).filter(([, e]) => e);
  const preview = async () => {
    setErr(null);
    const cur = await fresh(cc);
    try {
      const ch = addNodeDevices(cur, node, list, osdNodes);
      if (ch.noop) {
        setErr(ch.warnings[0] ?? 'Nothing changes.');
        return;
      }
      onClose();
      previewChange({
        title: `Add ${list.join(', ')} on ${node}`,
        op: 'update',
        before: cur,
        after: ch.after,
        consequences: ch.notes,
        warning: ch.warnings.length ? (
          <>
            {ch.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </>
        ) : undefined,
        action: 'Add storage',
        target: `CephCluster ${cc.metadata.name}`,
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="cairn-add-storage-title">
      <DialogTitle id="cairn-add-storage-title" sx={{ fontSize: 18 }}>
        Add a disk or node
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography sx={{ fontSize: 14, lineHeight: 1.55 }}>
          Lists devices of a node in spec.storage.nodes. Rook then prepares an OSD on each one that is empty. You see the change and can
          validate it before it is applied.
        </Typography>
        <TextField select size="small" label="Node" value={node} onChange={e => setNode(e.target.value)} helperText="The Kubernetes node name (kubernetes.io/hostname)">
          {nodes.map(n => (
            <MenuItem key={n} value={n}>
              {n}
              {osdNodes.includes(n) ? ' (has OSDs)' : ''}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Devices"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="sdc, /dev/disk/by-id/wwn-0x5000c500a1b2c3d4"
          error={bad.length > 0}
          helperText={bad.length ? `${bad[0][0]}: ${bad[0][1]}` : 'Kernel names (sdc, nvme1n1) or stable /dev/disk/by-id paths, separated by commas or spaces'}
          autoComplete="off"
        />
        {err && (
          <Notice tone="err" title="Cannot prepare the change">
            {err}
          </Notice>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={preview} variant="contained" disabled={!node || !list.length || bad.length > 0}>
          Preview change
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* --------------------------------------------------------- device filter */

function openFilter(cc: Obj, current: string, devices: string[]) {
  openDialog(close => <FilterDialog cc={cc} current={current} devices={devices} onClose={close} />);
}

function FilterDialog({ cc, current, devices, onClose }: { cc: Obj; current: string; devices: string[]; onClose: () => void }) {
  const [text, setText] = React.useState(current);
  const [err, setErr] = React.useState<string | null>(null);
  let check: { matches: string[]; error: string | null } = { matches: [], error: null };
  try {
    check = { matches: text ? devices.filter(d => new RegExp(text).test(d)) : [], error: null };
  } catch (e) {
    check = { matches: [], error: (e as Error).message };
  }
  const preview = async () => {
    setErr(null);
    const cur = await fresh(cc);
    try {
      const ch = setDeviceFilter(cur, text, devices);
      if (ch.noop) {
        setErr(ch.warnings[0] ?? 'Nothing changes.');
        return;
      }
      onClose();
      previewChange({
        title: `Change the device filter to ${text || '(none)'}`,
        op: 'update',
        before: cur,
        after: ch.after,
        consequences: ch.notes,
        warning: ch.warnings.length ? ch.warnings.join(' ') : undefined,
        action: 'Change the filter',
        target: `CephCluster ${cc.metadata.name}`,
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="cairn-filter-title">
      <DialogTitle id="cairn-filter-title" sx={{ fontSize: 18 }}>
        Change the device filter
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography sx={{ fontSize: 14, lineHeight: 1.55 }}>
          spec.storage.deviceFilter is a regular expression on kernel device names. Rook prepares OSDs on every empty disk that matches, on{' '}
          {cc.spec?.storage?.useAllNodes ? 'every node' : 'every listed node without its own device list'}.
        </Typography>
        <TextField
          size="small"
          label="Device filter"
          value={text}
          onChange={e => setText(e.target.value)}
          error={!!check.error}
          helperText={check.error ?? 'For example ^sd[b-d]$ or ^nvme[0-9]n1$'}
          autoComplete="off"
          inputProps={{ style: { fontFamily: 'monospace' } }}
        />
        {devices.length > 0 && !check.error && (
          <Hint>
            OSD disks Cairn knows: {devices.join(', ')}. The new filter matches {check.matches.length ? check.matches.join(', ') : 'none of them'}
            {check.matches.length < devices.length ? '; existing OSDs on the others keep running.' : '.'}
          </Hint>
        )}
        {err && (
          <Notice tone="err" title="Cannot prepare the change">
            {err}
          </Notice>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={preview} variant="contained" disabled={!!check.error || text === current}>
          Preview change
        </Button>
      </DialogActions>
    </Dialog>
  );
}
