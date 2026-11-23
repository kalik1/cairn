import { useTheme } from '@mui/material/styles';
import { CairnTokens, cairnTokens } from './tokens';

/** Cairn tokens for the current Headlamp theme (light or dark). */
export function useTokens(): CairnTokens {
  return cairnTokens(useTheme());
}
