/*
 * How many managers and monitors Rook runs: the counts in the CephCluster
 * (spec.mgr.count, spec.mon.count) with what each choice means, the ones
 * the cluster cannot take now and why, and the change through the usual
 * preview (diff, server-side dry run, apply). Also the removal of a mgr
 * module entry that Rook ignores. A field the k4all operator owns is shown
 * read-only: k4all would put its own value back at its next apply. Who owns
 * a field comes from a GET of the CephCluster, never from the listed copy:
 * Headlamp's lists drop managedFields (api/managedFields.ts). Today
 * k4all creates the CephCluster once (field manager k4all-operator-seed) and
 * owns its Ceph image (and, from v2.7.2, Rook's monitoring fields while its
 * monitoring is on: Operator.tsx); the checks stay for the fields it may own
 * later.
 */

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { pathOf } from '../../api/apply';
import { useCeph } from '../../api/ceph';
import { isK4all, useK4all } from '../../api/k4all';
import { useKube } from '../../api/kube';
import { useManagedFields } from '../../api/managedFields';
import {
  CountOption,
  mgrCount,
  mgrOptions,
  monCount,
  MonFacts,
  monFailuresTolerated,
  monOptions,
  NodeFacts,
  placeableNodes,
  quorumNeeds,
  removeMgrModule,
  setMgrCount,
  setMonCount,
} from '../../model/daemonCounts';
import { plural } from '../../model/format';
import { K4ALL_MANAGED, k4allOwnedFields } from '../../model/ownership';
import { Obj } from '../../model/types';
import { previewChange } from '../../ui/ChangeDialog';
import { Action, Mono, Notice, Panel } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { fresh, headlampUrl, Hint, useClusterEditReason } from '../overview/common';

/**
 * A page of the k4all addon's settings (/k4all/settings/<page>), when the
 * k4all plugin is loaded: its settings route plus the page. "storage" holds
 * what k4all owns of Rook (the Ceph image, monitoring, CephFS, the CSI image
 * variant).
 */
export function k4allAddonUrl(page = 'storage'): string | null {
  const base = headlampUrl('k4all-settings', {});
  return base && base !== '/' ? `${base.replace(/\/$/, '')}/${page}` : null;
}

/** Of these CephCluster fields, the ones k4all owns now, from a GET of it (none when k4all does not run the cluster). */
function useK4allOwned(cc: Obj | null, paths: string[]): string[] {
  const k4all = useK4all();
  const got = useManagedFields(cc, cc ? pathOf(cc) : null, k4all);
  return k4all ? k4allOwnedFields(got, paths) : [];
}

/**
 * Why a change to these fields of `now` (the CephCluster read fresh) is
 * not prepared, or null: k4all owns one, or `now` has no managedFields (the
 * GET failed and fresh() gave back the listed copy, which cannot tell).
 */
async function k4allRefusal(now: Obj, paths: string[]): Promise<string | null> {
  if (!(await isK4all())) return null;
  if (!now.metadata.managedFields?.length) {
    return `Cairn could not read the CephCluster just now, so it cannot tell whether k4all owns ${paths.join(', ')}. Try again.`;
  }
  return k4allOwnedFields(now, paths).length ? K4ALL_MANAGED : null;
}

/** Read-only note for fields the k4all operator owns, with a link to the addon page (`page`) that holds their setting. */
export function K4allManaged({ fields, sx, page = 'storage' }: { fields: string[]; sx?: object; page?: string }) {
  const url = k4allAddonUrl(page);
  return (
    <Notice tone="idle" icon="mdi:lock-outline" sx={sx} title={K4ALL_MANAGED}>
      The k4all operator applies <Mono>{fields.join(', ')}</Mono> to this CephCluster and would put its own value back after a change made here.{' '}
      {url ? (
        <Link component={RouterLink} to={url} underline="hover">
          Open the k4all addon
        </Link>
      ) : (
        'Change it in the k4all addon.'
      )}
    </Notice>
  );
}

/** The nodes where Rook can place the daemon, or null when Cairn cannot list nodes. */
function useNodeFacts(cc: Obj | null, daemon: 'mon' | 'mgr'): NodeFacts {
  const kube = useKube();
  const items = kube.nodes.items;
  const usable = kube.nodes.loaded && !kube.nodes.error;
  return React.useMemo(() => ({ placeable: usable ? placeableNodes(items, cc, daemon) : null }), [items, cc, daemon, usable]);
}

function useMonFacts(cc: Obj | null): MonFacts {
  const q = useCeph().core.quorum;
  const nodes = useNodeFacts(cc, 'mon');
  return React.useMemo(() => ({ ...nodes, monmap: q ? q.mons.map(m => m.name) : null, inQuorum: q?.quorum ?? [] }), [nodes, q]);
}

/* -------------------------------------------------------------- chooser */

function CountChoices({
  label,
  options,
  value,
  onChange,
  locked,
}: {
  label: string;
  options: CountOption[];
  value: number;
  onChange: (n: number) => void;
  locked: boolean;
}) {
  const t = useTokens();
  return (
    <RadioGroup value={String(value)} onChange={e => onChange(Number(e.target.value))} aria-label={label}>
      {options.map(o => (
        <FormControlLabel
          key={o.value}
          value={String(o.value)}
          disabled={locked || (!!o.off && !o.current)}
          control={<Radio size="small" />}
          sx={{ alignItems: 'flex-start', mb: 0.75, mr: 0, '& .MuiRadio-root': { mt: -0.5 }, '&.Mui-disabled .cairn-count-meaning': { opacity: 0.75 } }}
          label={
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography component="span" sx={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {o.value}
                </Typography>
                {o.current && <StateLabel tone="ok">In the CephCluster now</StateLabel>}
                {!o.current && o.confirm && !o.off && <StateLabel tone="warn">Needs a confirmation</StateLabel>}
              </Box>
              <Typography className="cairn-count-meaning" sx={{ fontSize: 12.5, color: t.muted, lineHeight: 1.5 }}>
                {o.meaning}
              </Typography>
              {o.off && !o.current && (
                <Typography sx={{ fontSize: 12.5, lineHeight: 1.5, color: t.text, mt: 0.25 }}>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    Not possible now:
                  </Box>{' '}
                  {o.off}.
                </Typography>
              )}
            </Box>
          }
        />
      ))}
    </RadioGroup>
  );
}

/* ------------------------------------------------------------- managers */

export function MgrCountPanel() {
  const t = useTokens();
  const kube = useKube();
  const { core } = useCeph();
  const editReason = useClusterEditReason();
  const cc = kube.cephCluster;
  const facts = useNodeFacts(cc, 'mgr');
  const cur = mgrCount(cc);
  const options = mgrOptions(cc, facts);
  const [want, setWant] = React.useState(cur);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => setWant(cur), [cur]);
  const owned = useK4allOwned(cc, ['spec.mgr.count']);
  const m = core.mgr;
  const running = m ? (m.active ? 1 : 0) + m.standbys.length : null;
  const chosen = options.find(o => o.value === want);
  const off = !cc ? 'No CephCluster' : editReason ?? (owned.length ? K4ALL_MANAGED : null) ?? (want === cur ? null : chosen?.off ?? null);

  const preview = async () => {
    if (!cc) return;
    setErr(null);
    const now = await fresh(cc);
    const refused = await k4allRefusal(now, ['spec.mgr.count']);
    if (refused) {
      setErr(refused);
      return;
    }
    try {
      const ch = setMgrCount(now, want, facts);
      if (ch.noop) {
        setErr(ch.warnings[0] ?? 'Nothing changes.');
        return;
      }
      await previewChange({
        title: `Run ${plural(want, 'manager', 'managers')}`,
        op: 'update',
        before: now,
        after: ch.after,
        consequences: ch.notes,
        action: want > mgrCount(now) ? 'Add a manager' : 'Remove a manager',
        target: `CephCluster ${now.metadata.name}`,
        onDone: () => kube.refresh(),
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Panel title="How many managers" icon="mdi:account-multiple-outline">
      <Typography sx={{ fontSize: 13.5, lineHeight: 1.55, mb: 1.25 }}>
        One manager is active at a time; the others wait on standby and take over when it fails. The count is{' '}
        <Mono>spec.mgr.count</Mono> in the CephCluster: Rook runs one or two.
        {running !== null && (
          <>
            {' '}
            Ceph runs {plural(running, 'manager', 'managers')} now
            {m && m.standbys.length ? ` (${plural(m.standbys.length, 'standby', 'standbys')})` : ', no standby'}
            {running !== cur ? `; Rook is moving to ${cur}` : ''}.
          </>
        )}
      </Typography>
      {owned.length > 0 && <K4allManaged fields={owned} sx={{ mb: 1.25 }} />}
      <CountChoices label="Number of managers" options={options} value={want} onChange={setWant} locked={!!editReason || owned.length > 0 || !cc} />
      {err && (
        <Notice tone="err" sx={{ mt: 1 }} title="Cannot prepare the change">
          {err}
        </Notice>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1, pt: 1.25, borderTop: `1px solid ${t.rule}` }}>
        <Action onClick={preview} reason={off} disabled={want === cur}>
          Preview change
        </Action>
        <Hint>Shows the change to the CephCluster; Rook adds or removes the manager.</Hint>
      </Box>
    </Panel>
  );
}

/* ------------------------------------------------------------- monitors */

export function MonCountPanel() {
  const t = useTokens();
  const kube = useKube();
  const editReason = useClusterEditReason();
  const cc = kube.cephCluster;
  const facts = useMonFacts(cc);
  const cur = monCount(cc);
  const options = monOptions(cc, facts);
  const [want, setWant] = React.useState(cur);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => setWant(cur), [cur]);
  const owned = useK4allOwned(cc, ['spec.mon.count']);
  const chosen = options.find(o => o.value === want);
  const multi = !!cc?.spec?.mon?.allowMultiplePerNode;
  const off = !cc ? 'No CephCluster' : editReason ?? (owned.length ? K4ALL_MANAGED : null) ?? (want === cur ? null : chosen?.off ?? null);

  const preview = async () => {
    if (!cc) return;
    setErr(null);
    const now = await fresh(cc);
    const refused = await k4allRefusal(now, ['spec.mon.count']);
    if (refused) {
      setErr(refused);
      return;
    }
    try {
      const ch = setMonCount(now, want, facts, true);
      if (ch.noop) {
        setErr(ch.warnings[0] ?? 'Nothing changes.');
        return;
      }
      const warn = [...(ch.confirm ? [ch.confirm] : []), ...ch.warnings];
      await previewChange({
        title: `Run ${plural(want, 'monitor', 'monitors')}`,
        op: 'update',
        before: now,
        after: ch.after,
        consequences: ch.notes,
        warning: warn.length ? (
          <>
            {warn.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </>
        ) : undefined,
        danger: !!ch.confirm,
        typeToConfirm: ch.confirm ? now.metadata.name : undefined,
        action: want > monCount(now) ? 'Add monitors' : 'Remove monitors',
        target: `CephCluster ${now.metadata.name}`,
        onDone: () => kube.refresh(),
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Panel title="How many monitors" icon="mdi:eye-plus-outline">
      <Box sx={{ fontSize: 13.5, lineHeight: 1.55, mb: 1.25, '& p': { m: 0, mb: 0.75 } }}>
        <p>
          Monitors keep the cluster maps and agree on them by majority: the quorum. With {cur} monitors the quorum needs {quorumNeeds(cur)}, so
          the cluster keeps running with {plural(monFailuresTolerated(cur), 'monitor', 'monitors')} down. Use an odd count: an even one
          tolerates no more failures than one less.
        </p>
        <p>
          The count is <Mono>spec.mon.count</Mono> in the CephCluster.{' '}
          {multi
            ? 'allowMultiplePerNode is on, so several monitors may share a node.'
            : facts.placeable
            ? `Rook runs one monitor per node, and ${plural(facts.placeable.length, 'node', 'nodes')} can run one.`
            : 'Rook runs one monitor per node.'}{' '}
          When the count goes down, Rook removes monitors one at a time; Cairn offers a change only while every monitor is in quorum, so the
          quorum holds at every step.
        </p>
      </Box>
      {owned.length > 0 && <K4allManaged fields={owned} sx={{ mb: 1.25 }} />}
      <CountChoices label="Number of monitors" options={options} value={want} onChange={setWant} locked={!!editReason || owned.length > 0 || !cc} />
      {err && (
        <Notice tone="err" sx={{ mt: 1 }} title="Cannot prepare the change">
          {err}
        </Notice>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1, pt: 1.25, borderTop: `1px solid ${t.rule}` }}>
        <Action onClick={preview} reason={off} disabled={want === cur}>
          Preview change
        </Action>
        <Hint>{chosen?.confirm && want !== cur ? 'Applying it asks you to type the CephCluster name.' : 'Shows the change to the CephCluster; Rook adds or removes monitors.'}</Hint>
      </Box>
    </Panel>
  );
}

/* --------------------------------------------------------- mgr modules */

/** Why the module list in the CephCluster cannot be edited here, or null. */
export function useModulesEditReason(): string | null {
  const kube = useKube();
  const editReason = useClusterEditReason();
  const owned = useK4allOwned(kube.cephCluster, ['spec.mgr.modules']);
  if (!kube.cephCluster) return 'No CephCluster';
  return editReason ?? (owned.length ? K4ALL_MANAGED : null);
}

/** Preview the CephCluster without the module's entry in spec.mgr.modules. */
export async function previewRemoveModule(cc: Obj, name: string, cephVersion: string, onDone?: () => void): Promise<void> {
  const now = await fresh(cc);
  const refused = await k4allRefusal(now, ['spec.mgr.modules']);
  if (refused) throw new Error(refused);
  const ch = removeMgrModule(now, name, cephVersion);
  if (ch.noop) throw new Error(ch.warnings[0] ?? 'Nothing changes.');
  await previewChange({
    title: `Remove ${name} from the CephCluster's mgr modules`,
    op: 'update',
    before: now,
    after: ch.after,
    consequences: ch.notes,
    action: 'Remove the entry',
    target: `CephCluster ${now.metadata.name}`,
    onDone,
  });
}
