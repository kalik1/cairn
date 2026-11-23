/*
 * The Cairn mark: three stones stacked, the top one in the health colour.
 */

import React from 'react';
import { STATE, StateTone } from './tokens';

export function CairnMark({ size = 22, tone, stone = '#93A4AE' }: { size?: number; tone?: StateTone; stone?: string }) {
  const top = tone ? STATE[tone] : stone;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <rect x="3" y="16.5" width="18" height="5.5" rx="2.75" fill={stone} />
      <rect x="5.5" y="10" width="13" height="5.2" rx="2.6" fill={stone} opacity="0.85" />
      <rect x="8.5" y="3.5" width="7" height="5.2" rx="2.6" fill={top} />
    </svg>
  );
}
