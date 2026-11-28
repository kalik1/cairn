/*
 * The cephx migration ladder for CVE-2025-30156 on the basalt band: five
 * steps with their live status, what each does and risks, and the Rook
 * change that carries it out (always through the change preview, behind a
 * typed confirmation).
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import React from 'react';
import { useKube } from '../../api/kube';
import { rookAttrs, useCan } from '../../api/permissions';
import { dropPriorCsi, onlyAes256k, rotateCsi, rotateDaemons, rotateMirrorPeer } from '../../api/securityOps';
import { CsiReadiness, KeySummary, LadderStep, nextStep, StepState } from '../../model/cephx';
import { Figure } from '../../ui/kit';
import { Mark } from '../../ui/Mark';
import { STATE, StateTone, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';

const STEP_TONE: Record<StepState, StateTone> = { done: 'ok', todo: 'warn', partial: 'move', none: 'idle', unknown: 'idle' };
const STEP_WORD: Record<StepState, string> = { done: 'Done', todo: 'To do', partial: 'Partly done', none: 'Nothing to do', unknown: 'Unknown' };

const WHAT: Record<string, string> = {
  daemon:
    'Rook gives every Ceph daemon and client.admin a new aes256k key. Once the OSDs have theirs, every service ticket is aes256k, even for clients still on aes: this closes the main attack. Daemons restart one after the other.',
  csi: 'The keys Ceph-CSI mounts volumes with on every node. Needs Ceph-CSI 3.17.1+ and kernel 7.0+ everywhere; mounted volumes keep the old key until their node is drained.',
  clients: 'CephClient users for consumers outside the cluster. Only for clients with Ceph 19.2.6 / 20.2.4 libraries or kernel 7.0+.',
  mirror: 'The key RBD mirror peers pull images with. Keep aes while a peer cluster cannot use aes256k.',
  ciphers: 'The monitors then refuse every aes key. Only safe when every key is aes256k; it clears AUTH_INSECURE_KEYS_ALLOWED.',
};

function BandButton({
  children,
  onClick,
  reason,
  danger,
  quiet,
}: {
  children: React.ReactNode;
  onClick: () => void;
  reason?: string | null;
  danger?: boolean;
  /** A repeat of a done step: a text button, not a call to action. */
  quiet?: boolean;
}) {
  const btn = (
    <Button
      size="small"
      variant={quiet ? 'text' : 'outlined'}
      onClick={onClick}
      disabled={!!reason}
      sx={{
        textTransform: 'none',
        fontWeight: 550,
        color: quiet ? '#93A4AE' : '#E8EEF1',
        px: quiet ? 0.75 : undefined,
        ml: quiet ? -0.75 : undefined,
        borderColor: danger ? `${STATE.warn}AA` : 'rgba(232,238,241,0.35)',
        '&:hover': { borderColor: '#E8EEF1', background: 'rgba(255,255,255,0.06)' },
        '&.Mui-disabled': { color: 'rgba(232,238,241,0.4)', borderColor: 'rgba(232,238,241,0.15)' },
        '&:focus-visible': { outline: `2px solid ${STATE.move}`, outlineOffset: 2 },
      }}
    >
      {children}
    </Button>
  );
  return reason ? (
    <Tooltip title={reason}>
      <span>{btn}</span>
    </Tooltip>
  ) : (
    btn
  );
}

export function LadderBand({
  steps,
  summary,
  readiness,
  versionOk,
  version,
}: {
  steps: LadderStep[];
  summary: KeySummary | null;
  readiness: CsiReadiness;
  versionOk: boolean | null;
  version: string;
}) {
  const t = useTokens();
  const kube = useKube();
  const cluster = kube.cephCluster;
  const canEdit = useCan(rookAttrs('update', 'cephclusters', kube.ns));
  const editReason = !cluster ? 'No CephCluster' : canEdit ? null : 'Your role does not allow editing the CephCluster';
  const next = nextStep(steps);
  const unknown = steps.every(s => s.state === 'unknown');
  const allDone = !unknown && !next && steps[4].state === 'done';
  const verdict = unknown
    ? 'Where the keys stand needs Ceph’s live state'
    : allDone
    ? 'Closed: every key is aes256k and the monitors refuse aes'
    : summary && summary.aes > 0
    ? `${summary.aes} key${summary.aes === 1 ? '' : 's'} still use${summary.aes === 1 ? 's' : ''} aes`
    : 'Every key is aes256k; the monitors still accept aes';
  const tone: StateTone = unknown ? 'idle' : allDone ? 'ok' : summary && summary.aes > 0 ? 'err' : 'warn';

  const action = (s: LadderStep): React.ReactNode => {
    if (!cluster || s.state === 'unknown' || s.state === 'none') return null;
    const again = s.state === 'done';
    switch (s.id) {
      case 'daemon':
        return (
          <BandButton onClick={() => rotateDaemons(cluster)} reason={editReason ?? (versionOk === false ? `Ceph ${version} has no aes256k: upgrade to 20.2.4 or 19.2.6 first` : null)} danger={!again} quiet={again}>
            {again ? 'Rotate again' : 'Rotate daemon keys'}
          </BandButton>
        );
      case 'csi': {
        const prior = s.state === 'partial' && s.insecure.length > 0 && s.evidence.some(e => e.includes('prior key'));
        if (prior)
          return (
            <BandButton onClick={() => dropPriorCsi(cluster)} reason={editReason} danger>
              Remove prior keys
            </BandButton>
          );
        return (
          <BandButton onClick={() => rotateCsi(cluster)} reason={editReason ?? (readiness.ready ? null : readiness.problems.join(' '))} danger={!again} quiet={again}>
            {again ? 'Rotate again' : 'Rotate Ceph-CSI keys'}
          </BandButton>
        );
      }
      case 'clients':
        return again ? null : (
          <BandButton onClick={() => document.getElementById('cairn-cephclients')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Go to CephClients</BandButton>
        );
      case 'mirror':
        return (
          <BandButton onClick={() => rotateMirrorPeer(cluster)} reason={editReason} danger={!again} quiet={again}>
            {again ? 'Rotate again' : 'Rotate mirror peer key'}
          </BandButton>
        );
      case 'ciphers':
        return again ? null : (
          <BandButton onClick={() => onlyAes256k(cluster)} reason={editReason ?? s.blockedBy ?? null} danger>
            Allow only aes256k
          </BandButton>
        );
    }
    return null;
  };

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 280 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Mark tone={tone} size={12} />
            <Box component="h2" sx={{ m: 0, fontSize: 20, fontWeight: 650, lineHeight: 1.3 }}>
              {verdict}
            </Box>
          </Box>
          <Box sx={{ color: t.basaltMuted, fontSize: 13.5, mt: 0.75, maxWidth: 820, lineHeight: 1.55 }}>
            CVE-2025-30156: Ceph’s old cephx key type (aes) lets someone with any key, or who watches cephx traffic, forge the tickets monitors hand out. The fix
            is aes256k, then turning aes off, in this order.
            {next ? ` Next: ${next.title.charAt(0).toLowerCase()}${next.title.slice(1)}.` : ''}
          </Box>
        </Box>
        {summary && (
          <Box sx={{ display: 'flex', gap: 3, ...tabular }}>
            <Figure onBand value={summary.aes256k} label="keys on aes256k" />
            <Figure onBand value={summary.aes} label="keys on aes" tone={summary.aes > 0 ? 'warn' : undefined} />
            <Figure onBand value={version || '—'} label={versionOk === false ? 'Ceph: no aes256k' : 'Ceph version'} tone={versionOk === false ? 'warn' : undefined} />
          </Box>
        )}
      </Box>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
        {steps.map((s, i) => {
          const st = STEP_TONE[s.state];
          return (
            <Box
              component="li"
              key={s.id}
              aria-label={`Step ${i + 1}: ${s.title}, ${STEP_WORD[s.state]}`}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                p: 1.5,
                borderRadius: `${t.radius.panel}px`,
                background: next?.id === s.id ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${next?.id === s.id ? 'rgba(255,255,255,0.22)' : t.basaltEdge}`,
                borderTop: `3px solid ${STATE[st]}`,
                minWidth: 0,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, justifyContent: 'space-between' }}>
                <Box sx={{ fontSize: 12.5, color: t.basaltMuted }}>Step {i + 1}</Box>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 13 }}>
                  <Mark tone={st} size={8} />
                  {STEP_WORD[s.state]}
                </Box>
              </Box>
              <Box sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{s.title}</Box>
              <Box sx={{ fontSize: 12.5, color: t.basaltMuted, lineHeight: 1.5 }}>{WHAT[s.id]}</Box>
              <Box component="ul" sx={{ m: 0, pl: 2, fontSize: 12.5, lineHeight: 1.5, '& li': { mb: 0.25 } }}>
                {s.evidence.map((e, j) => (
                  <li key={j}>{e}</li>
                ))}
                {s.pending && <li style={{ color: STATE.move }}>{s.pending}</li>}
                {s.insecure.length > 0 && s.id !== 'ciphers' && (
                  <li>
                    Still aes:{' '}
                    <Box component="span" sx={{ fontFamily: t.font.mono }}>
                      {s.insecure.slice(0, 4).join(', ')}
                      {s.insecure.length > 4 ? '…' : ''}
                    </Box>
                  </li>
                )}
                {s.id === 'ciphers' && s.blockedBy && <li style={{ color: STATE.warn }}>{s.blockedBy}</li>}
                {s.id === 'csi' && s.state !== 'done' && s.state !== 'unknown' && !readiness.ready && <li style={{ color: STATE.warn }}>{readiness.problems.join(' ')}</li>}
              </Box>
              <Box sx={{ mt: 'auto', pt: 0.5 }}>{action(s)}</Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
