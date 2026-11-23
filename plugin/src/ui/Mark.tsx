/*
 * State mark: a small square stone (rounded) in the state colour. "move"
 * pulses unless the user prefers reduced motion; "idle" is hollow. Always
 * pair it with a word: colour alone never carries the state.
 */

import Box from '@mui/material/Box';
import { keyframes } from '@mui/material/styles';
import React from 'react';
import { STATE, StateTone } from './tokens';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

export function Mark({ tone, size = 9, title }: { tone: StateTone; size?: number; title?: string }) {
  const color = STATE[tone];
  const hollow = tone === 'idle';
  return (
    <Box
      component="span"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
      sx={{
        display: 'inline-block',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: `${Math.max(2, size / 3.5)}px`,
        boxSizing: 'border-box',
        background: hollow ? 'transparent' : color,
        border: hollow ? `1.5px solid ${color}` : 'none',
        animation: tone === 'move' ? `${pulse} 1.6s ease-in-out infinite` : 'none',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    />
  );
}

/** A mark with its word. */
export function StateLabel({
  tone,
  children,
  title,
  size = 'md',
}: {
  tone: StateTone;
  children: React.ReactNode;
  title?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <Box component="span" title={title} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.8, minWidth: 0 }}>
      <Mark tone={tone} size={size === 'sm' ? 8 : 9} />
      <Box
        component="span"
        sx={{ fontSize: size === 'sm' ? 13 : 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {children}
      </Box>
    </Box>
  );
}
