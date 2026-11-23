/*
 * Crash reports collected by Ceph's crash module: new and archived, the
 * full report of one, archive one or all. Without Rook's crash collector
 * nothing gets reported, and the panel says so.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { archiveAllCrashes, archiveCrash, crashInfo } from '../../api/healthOps';
import { useKube } from '../../api/kube';
import { crashCollectorDisabled } from '../../model/clusterSpec';
import { ago } from '../../model/format';
import { CrashEntry } from '../../model/types';
import { Column, DataTable } from '../../ui/DataTable';
import { confirm, openDialog } from '../../ui/dialogs';
import { Action, Empty, KV, Mono, Notice, Panel } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { useCephReason } from './common';

export function Crashes() {
  const c = useCeph();
  const kube = useKube();
  const reason = useCephReason();
  const [showArchived, setShowArchived] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const all = c.core.crashes;
  const fresh = all.filter(x => !x.archived);
  const rows = showArchived ? all : fresh;
  const off = crashCollectorDisabled(kube.cephCluster);

  const archive = async (x: CrashEntry) => {
    setErr(null);
    try {
      await archiveCrash(c.ns, x.id, x.entity, c.refresh);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const archiveAll = async () => {
    const ok = await confirm({
      title: 'Archive every crash report?',
      body: <p>The reports stay readable (Show archived); Ceph stops counting them in RECENT_CRASH.</p>,
      confirm: 'Archive all',
    });
    if (!ok) return;
    setErr(null);
    try {
      await archiveAllCrashes(c.ns, c.refresh);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const cols: Column<CrashEntry>[] = [
    { id: 'time', header: 'When', cell: x => (x.time ? <span title={new Date(x.time).toLocaleString()}>{ago(x.time)}</span> : '—'), sort: x => x.time ?? 0, width: 120 },
    { id: 'entity', header: 'Daemon', cell: x => <Mono>{x.entity}</Mono>, sort: x => x.entity },
    { id: 'process', header: 'Process', cell: x => x.process ?? '—', sort: x => x.process ?? '', minWidth: 700 },
    { id: 'version', header: 'Version', cell: x => x.version ?? '—', sort: x => x.version ?? '', minWidth: 820 },
    {
      id: 'state',
      header: 'State',
      cell: x => <StateLabel tone={x.archived ? 'idle' : 'warn'}>{x.archived ? 'Archived' : 'New'}</StateLabel>,
      sort: x => (x.archived ? 1 : 0),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: x => (
        <Box sx={{ display: 'inline-flex', gap: 1 }}>
          <Action onClick={() => openCrash(c.ns, x)} reason={reason}>
            Details
          </Action>
          {!x.archived && (
            <Action onClick={() => archive(x)} reason={reason}>
              Archive
            </Action>
          )}
        </Box>
      ),
    },
  ];
  return (
    <Panel
      title="Crash reports"
      icon="mdi:alert-decagram-outline"
      id="crashes"
      actions={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FormControlLabel
            control={<Switch size="small" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />}
            label="Show archived"
            sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: 13 } }}
          />
          <Action onClick={archiveAll} disabled={!fresh.length} reason={reason}>
            Archive all
          </Action>
        </Box>
      }
      dense
    >
      {off && (
        <Notice tone="idle" sx={{ m: 1.5 }} title="The crash collector is off">
          spec.crashCollector.disable is true in the CephCluster, so Rook runs no crash collector: daemons that crash are restarted by
          Kubernetes, but no report reaches Ceph. Turn it on to see crashes here.
        </Notice>
      )}
      {err && (
        <Notice tone="err" title="The operation failed" sx={{ m: 1.5 }}>
          {err}
        </Notice>
      )}
      <DataTable
        label="Crash reports"
        rows={rows}
        columns={cols}
        rowKey={x => x.id}
        initialSort={{ id: 'time', dir: 'desc' }}
        empty={
          <Empty icon="mdi:shield-check-outline" title={showArchived ? 'No crash reports' : 'No new crash reports'}>
            {all.length && !showArchived ? `${all.length} archived reports are kept: switch on Show archived to read them.` : 'Daemons have not crashed, or no report reached Ceph.'}
          </Empty>
        }
      />
    </Panel>
  );
}

function openCrash(ns: string, x: CrashEntry) {
  openDialog(close => <CrashDialog ns={ns} crash={x} onClose={close} />);
}

function CrashDialog({ ns, crash, onClose }: { ns: string; crash: CrashEntry; onClose: () => void }) {
  const t = useTokens();
  const [info, setInfo] = React.useState<Record<string, any> | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    crashInfo(ns, crash.id).then(setInfo, e => setErr((e as Error).message));
  }, [ns, crash.id]);
  const bt: string[] = Array.isArray(info?.backtrace) ? info!.backtrace.map(String) : [];
  const known = new Set(['backtrace', 'crash_id', 'entity_name', 'timestamp', 'process_name', 'ceph_version', 'utsname_hostname', 'utsname_release', 'os_name', 'os_version', 'assert_condition', 'assert_func', 'assert_file', 'assert_line', 'assert_msg', 'archived']);
  const extra = info ? Object.entries(info).filter(([k, v]) => !known.has(k) && (typeof v !== 'object' || v === null)) : [];
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="cairn-crash-title">
      <DialogTitle id="cairn-crash-title" sx={{ fontSize: 18 }}>
        Crash of {crash.entity}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {err && (
          <Notice tone="err" title="Could not read the report">
            {err}
          </Notice>
        )}
        {!info && !err && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: t.muted }}>
            <CircularProgress size={16} /> Reading the report…
          </Box>
        )}
        {info && (
          <>
            <KV
              rows={[
                ['Crash id', <Mono key="id">{info.crash_id}</Mono>],
                ['Daemon', <Mono key="e">{info.entity_name}</Mono>],
                ['When', info.timestamp ? `${info.timestamp} (${ago(crash.time)})` : '—'],
                ['Process', info.process_name],
                ['Ceph version', info.ceph_version],
                ['Host', info.utsname_hostname ? `${info.utsname_hostname}${info.utsname_release ? `, kernel ${info.utsname_release}` : ''}` : null],
                ['OS', info.os_name ? `${info.os_name} ${info.os_version ?? ''}` : null],
                info.assert_condition && ['Assertion', <Mono key="a">{info.assert_condition}</Mono>],
                info.assert_func && ['In', <Mono key="f">{`${info.assert_func}${info.assert_file ? ` (${info.assert_file}:${info.assert_line ?? '?'})` : ''}`}</Mono>],
                info.assert_msg && ['Message', <Box key="m" component="span" sx={{ whiteSpace: 'pre-wrap' }}>{String(info.assert_msg)}</Box>],
                ['State', crash.archived ? 'Archived' : 'New'],
                ...extra.map(([k, v]) => [k, String(v)] as [string, string]),
              ]}
            />
            {bt.length > 0 && (
              <Box>
                <Box sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.5 }}>Backtrace</Box>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.25,
                    maxHeight: 320,
                    overflow: 'auto',
                    fontFamily: t.font.mono,
                    fontSize: 12,
                    lineHeight: 1.5,
                    background: t.sunken,
                    border: `1px solid ${t.rule}`,
                    borderRadius: `${t.radius.small}px`,
                  }}
                >
                  {bt.join('\n')}
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
