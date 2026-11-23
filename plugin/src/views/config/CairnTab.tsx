/*
 * Cairn's own settings (kept in this browser): where Ceph commands run and
 * which pod runs them now, how often the live view refreshes; and what the
 * current user may do, from SelfSubjectAccessReviews, with the Cairn roles
 * (distribution/rbac.yaml) that grant it.
 */

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { AccessCheck, accessChecks, attrsText, CairnRole, ROLES } from '../../api/configOps';
import { useKube } from '../../api/kube';
import { clearPermissionCache, useCanState } from '../../api/permissions';
import { useSettings } from '../../shell/settings';
import { Action, KV, Mono, Notice, Panel } from '../../ui/kit';
import { StateLabel } from '../../ui/Mark';
import { useTokens } from '../../ui/useTokens';
import { SmallSelect } from '../kubernetes/parts';

const BRIDGES: { value: 'auto' | 'toolbox' | 'operator'; label: string; help: string }[] = [
  { value: 'auto', label: 'Automatic', help: 'The Rook toolbox when it runs, else the Rook operator pod.' },
  { value: 'toolbox', label: 'The Rook toolbox only', help: 'A rook-ceph-tools pod (app=rook-ceph-tools) must run in the cluster’s namespace.' },
  { value: 'operator', label: 'The Rook operator only', help: 'Uses the operator’s admin keyring, the way the kubectl rook-ceph plugin does.' },
];

export function CairnTab() {
  const t = useTokens();
  const ceph = useCeph();
  const kube = useKube();
  const [settings, update] = useSettings();
  const [gen, setGen] = React.useState(0);
  const b = ceph.bridge;
  const execNs = b?.status === 'ready' ? b.target.namespace : b?.namespace ?? kube.ns;
  const checks = accessChecks(kube.ns, execNs);
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1.45fr)' }, alignItems: 'start' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <Panel title="Where Ceph commands run" icon="mdi:console">
          <RadioGroup value={settings.bridge} onChange={e => update({ bridge: e.target.value as typeof settings.bridge })} aria-label="Where Ceph commands run">
            {BRIDGES.map(o => (
              <FormControlLabel
                key={o.value}
                value={o.value}
                control={<Radio size="small" />}
                sx={{ alignItems: 'flex-start', mb: 0.5, '& .MuiRadio-root': { mt: -0.5 } }}
                label={
                  <Box>
                    <Typography sx={{ fontSize: 14 }}>{o.label}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: t.muted }}>{o.help}</Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
          <Box sx={{ borderTop: `1px solid ${t.rule}`, mt: 1, pt: 1.5 }}>
            {!b ? (
              <Typography sx={{ fontSize: 13.5, color: t.muted }}>Looking for a pod…</Typography>
            ) : b.status === 'ready' ? (
              <KV
                labelWidth={130}
                rows={[
                  ['Now', <StateLabel key="s" tone="ok">Running in the {b.target.kind === 'toolbox' ? 'Rook toolbox' : 'Rook operator'}</StateLabel>],
                  ['Pod', <Mono key="p">{`${b.target.namespace}/${b.target.pod}`}</Mono>],
                  ['Container', <Mono key="c">{b.target.container}</Mono>],
                  ['Configuration', <Mono key="f">{b.target.conf}</Mono>],
                  ['Last answer', ceph.updatedAt ? new Date(ceph.updatedAt).toLocaleTimeString() : '—'],
                ]}
              />
            ) : (
              <Notice tone={b.status === 'forbidden' ? 'warn' : 'idle'} title={b.status === 'forbidden' ? 'Not allowed' : 'No pod to run commands in'}>
                {b.reason}
              </Notice>
            )}
          </Box>
          <Typography sx={{ fontSize: 12.5, color: t.muted, mt: 1.5 }}>
            Every command batch is one exec under your Kubernetes user: the API server’s audit log records it. Secrets never leave the pod.
          </Typography>
        </Panel>
        <Panel title="Live view" icon="mdi:sync">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <SmallSelect
              label="Refresh every"
              value={String(settings.refreshSec)}
              onChange={v => update({ refreshSec: Number(v) })}
              width={170}
              name="cairn-refresh"
              options={[5, 10, 15, 30, 60].map(s => ({ value: String(s), label: `${s} seconds` }))}
            />
            <Typography sx={{ fontSize: 12.5, color: t.muted, flex: 1, minWidth: 220 }}>
              How often Cairn reads Ceph’s state while the page is visible. Charts keep an hour of samples. Kept in this browser.
            </Typography>
          </Box>
        </Panel>
        <Panel title="Cairn roles" icon="mdi:account-key-outline">
          <Box component="dl" sx={{ m: 0 }}>
            {ROLES.map(r => (
              <Box key={r.role} sx={{ mb: 1.5, '&:last-child': { mb: 0 } }}>
                <Box component="dt" sx={{ fontSize: 13.5, fontWeight: 600 }}>
                  <Mono>{r.role}</Mono> <Box component="span" sx={{ fontWeight: 400 }}>{r.summary}</Box>
                </Box>
                <Box component="dd" sx={{ m: 0, mt: 0.25, fontSize: 13, color: t.muted, lineHeight: 1.5 }}>
                  {r.detail}
                </Box>
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: 12.5, color: t.muted, mt: 1.5 }}>
            Bind cairn-viewer and cairn-editor with a ClusterRoleBinding; cairn-admin with a RoleBinding in the namespace of the CephCluster and of the Rook
            operator.
          </Typography>
        </Panel>
      </Box>
      <Panel
        title="What you may do"
        icon="mdi:shield-account-outline"
        dense
        actions={
          <Action
            icon="mdi:refresh"
            onClick={() => {
              clearPermissionCache();
              setGen(g => g + 1);
            }}
          >
            Check again
          </Action>
        }
      >
        <Access key={gen} checks={checks} />
      </Panel>
    </Box>
  );
}

function Access({ checks }: { checks: AccessCheck[] }) {
  const t = useTokens();
  const [results, setResults] = React.useState<Record<string, boolean | null>>({});
  const report = React.useCallback((id: string, v: boolean | null) => setResults(r => (r[id] === v ? r : { ...r, [id]: v })), []);
  const allowed = (role: CairnRole) => {
    const mine = checks.filter(c => c.role === role);
    if (mine.some(c => results[c.id] === null || results[c.id] === undefined)) return null;
    return mine.every(c => results[c.id]);
  };
  const viewer = allowed('cairn-viewer');
  const editor = allowed('cairn-editor');
  const admin = allowed('cairn-admin');
  const summary =
    viewer === null || editor === null || admin === null
      ? 'Checking…'
      : admin && editor
      ? 'You can do everything Cairn offers (cairn-admin with cairn-editor, or cluster-admin).'
      : admin
      ? 'You run Ceph commands but may not change Rook resources: like cairn-admin without cairn-editor.'
      : editor
      ? 'You change Rook resources and StorageClasses but may not run Ceph commands: like cairn-editor.'
      : viewer
      ? 'You see what Kubernetes knows, without Ceph’s live state or operations: like cairn-viewer.'
      : 'Your role misses some of what cairn-viewer gives: parts of Cairn stay empty.';
  return (
    <>
      <Typography sx={{ fontSize: 13.5, px: 2, py: 1.25, borderBottom: `1px solid ${t.rule}` }}>{summary}</Typography>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <Box component="thead">
          <Box component="tr" sx={{ borderBottom: `1px solid ${t.rule}`, color: t.muted, fontSize: 12.5, textAlign: 'left', whiteSpace: 'nowrap' }}>
            <Box component="th" sx={{ px: 2, py: 0.75, fontWeight: 600 }}>
              Action
            </Box>
            <Box component="th" sx={{ px: 1, py: 0.75, fontWeight: 600 }}>
              Kubernetes permission
            </Box>
            <Box component="th" sx={{ px: 1, py: 0.75, fontWeight: 600 }}>
              You
            </Box>
            <Box component="th" sx={{ px: 2, py: 0.75, fontWeight: 600 }}>
              Role that grants it
            </Box>
          </Box>
        </Box>
        <Box component="tbody">
          {checks.map(c => (
            <AccessRow key={c.id} c={c} report={report} />
          ))}
        </Box>
      </Box>
    </>
  );
}

function AccessRow({ c, report }: { c: AccessCheck; report: (id: string, v: boolean | null) => void }) {
  const t = useTokens();
  const ok = useCanState(c.attrs);
  React.useEffect(() => report(c.id, ok), [c.id, ok, report]);
  return (
    <Box component="tr" sx={{ borderBottom: `1px solid ${t.rule}` }}>
      <Box component="td" sx={{ px: 2, py: 0.75 }}>
        {c.what}
      </Box>
      <Box component="td" sx={{ px: 1, py: 0.75 }}>
        <Mono muted>{attrsText(c.attrs)}</Mono>
      </Box>
      <Box component="td" sx={{ px: 1, py: 0.75, whiteSpace: 'nowrap' }}>
        {ok === null ? <StateLabel tone="idle">Checking</StateLabel> : ok ? <StateLabel tone="ok">Allowed</StateLabel> : <StateLabel tone="warn">Not allowed</StateLabel>}
      </Box>
      <Box component="td" sx={{ px: 2, py: 0.75 }}>
        <Mono>{c.role}</Mono>
      </Box>
    </Box>
  );
}
