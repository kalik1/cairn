/*
 * Cairn design tokens.
 *
 * The idea: a geologist's section of the cluster. Pages are quiet and
 * dense (Headlamp's theme and font, tabular numbers, hairlines); data is
 * drawn as strata and fields. Each screen has one loud element on a basalt
 * band: the health verdict with the placement-group field on the overview,
 * the host shelves on Hosts & OSDs, the capacity strata on a pool.
 *
 * State colours carry data safety everywhere, always with a word next to
 * them: lichen (clean, up, in), ochre (needs attention), garnet (failing,
 * data at risk), cobalt (moving: recovery, backfill, scrub), slate (off,
 * unknown).
 */

import { Theme } from '@mui/material/styles';

export const STATE = {
  ok: '#3BA57E',
  warn: '#D9A02B',
  err: '#D3424F',
  move: '#4A86E0',
  idle: '#7C8A94',
} as const;

export type StateTone = keyof typeof STATE;

/** Chart series: client reads, client writes, recovery, latency. */
export const SERIES = {
  read: '#4A86E0',
  write: '#9067D6',
  recovery: '#D9A02B',
  latency: '#2FA39A',
  other: '#7C8A94',
} as const;

export interface CairnTokens {
  dark: boolean;
  /** The basalt band (always dark): the one loud element of a screen. */
  basalt: string;
  basaltEdge: string;
  basaltText: string;
  basaltMuted: string;
  /** Page background, panel surface, hairlines. */
  sunken: string;
  surface: string;
  rule: string;
  text: string;
  muted: string;
  selected: string;
  hover: string;
  accent: string;
  /** Meters: used, reserved, track. */
  meterUsed: string;
  meterAlloc: string;
  meterTrack: string;
  /** Tinted backgrounds for notices. */
  tint: Record<StateTone, string>;
  radius: { small: number; panel: number };
  font: { mono: string };
}

export function cairnTokens(theme: Theme): CairnTokens {
  const dark = theme.palette.mode === 'dark';
  const a = (hex: string, alpha: number) =>
    `${hex}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0')}`;
  return {
    dark,
    basalt: dark ? '#1C2B35' : '#1E2B33',
    basaltEdge: dark ? '#34495A' : '#2C3C46',
    basaltText: '#E8EEF1',
    basaltMuted: '#93A4AE',
    sunken: dark ? '#141A1E' : '#F1F4F5',
    surface: theme.palette.background.paper,
    rule: theme.palette.divider,
    text: theme.palette.text.primary,
    muted: theme.palette.text.secondary,
    selected: dark ? 'rgba(74,134,224,0.18)' : 'rgba(74,134,224,0.12)',
    hover: dark ? 'rgba(255,255,255,0.04)' : 'rgba(16,24,32,0.04)',
    accent: theme.palette.primary.main,
    meterUsed: dark ? '#5B97EA' : '#3570C8',
    meterAlloc: dark ? 'rgba(91,151,234,0.35)' : 'rgba(53,112,200,0.25)',
    meterTrack: dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,24,32,0.08)',
    tint: {
      ok: a(STATE.ok, dark ? 0.14 : 0.1),
      warn: a(STATE.warn, dark ? 0.16 : 0.13),
      err: a(STATE.err, dark ? 0.16 : 0.1),
      move: a(STATE.move, dark ? 0.16 : 0.1),
      idle: a(STATE.idle, dark ? 0.16 : 0.1),
    },
    radius: { small: 4, panel: 6 },
    font: {
      mono: '"JetBrains Mono", "Overpass Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    },
  };
}

/** Numbers line up in tables and meters. */
export const tabular = { fontVariantNumeric: 'tabular-nums' } as const;

/** Text colour for a state word (garnet and ochre darken a bit on light backgrounds). */
export function stateText(tone: StateTone, dark: boolean): string {
  if (dark) return STATE[tone];
  return { ok: '#23805E', warn: '#9A6B0E', err: '#B8303C', move: '#2F68C0', idle: '#5D6B74' }[tone];
}
