/*
 * The activity strip: the operation running now, or the last one for a
 * few seconds after it ends, bottom right. The Activity view has them all.
 */

import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import React from 'react';
import { useActivity } from '../api/activity';
import { STATE } from '../ui/tokens';
import { useTokens } from '../ui/useTokens';
import { useNav } from './nav';

export function ActivityStrip() {
  const ops = useActivity();
  const t = useTokens();
  const nav = useNav();
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const shown = ops.filter(o => o.status === 'running' || (o.ended && now - o.ended < 8000)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <Box sx={{ position: 'fixed', right: 20, bottom: 20, zIndex: 1300, display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 440 }} aria-live="polite">
      {shown.map(o => (
        <Box
          key={o.id}
          role="status"
          onClick={() => nav.go('activity')}
          sx={{
            cursor: 'pointer',
            display: 'flex',
            gap: 1.25,
            alignItems: 'flex-start',
            background: t.basalt,
            color: t.basaltText,
            borderRadius: `${t.radius.panel}px`,
            px: 1.75,
            py: 1.25,
            boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
            borderLeft: `3px solid ${o.status === 'failed' ? STATE.err : o.status === 'done' ? STATE.ok : STATE.move}`,
          }}
        >
          {o.status === 'running' ? (
            <CircularProgress size={16} sx={{ color: STATE.move, mt: 0.25 }} />
          ) : (
            <Icon icon={o.status === 'done' ? 'mdi:check' : 'mdi:alert-octagon-outline'} width={18} color={o.status === 'done' ? STATE.ok : STATE.err} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ fontSize: 14, fontWeight: 600 }}>{o.title}</Box>
            {o.message && o.status !== 'running' && (
              <Box sx={{ fontSize: 13, color: t.basaltMuted, overflowWrap: 'anywhere' }}>{o.message.slice(0, 240)}</Box>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
