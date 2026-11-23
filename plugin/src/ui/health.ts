/*
 * Health words and tones shared by the shell, the app-bar badge and views.
 */

import { Severity } from '../model/types';
import { StateTone } from './tokens';

export function healthTone(s?: Severity | string | null): StateTone {
  if (s === 'HEALTH_OK') return 'ok';
  if (s === 'HEALTH_WARN') return 'warn';
  if (s === 'HEALTH_ERR') return 'err';
  return 'idle';
}

export function healthWord(s?: Severity | string | null): string {
  if (s === 'HEALTH_OK') return 'Healthy';
  if (s === 'HEALTH_WARN') return 'Warning';
  if (s === 'HEALTH_ERR') return 'Error';
  return 'Unknown';
}
