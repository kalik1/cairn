/*
 * The app-bar badge's words: Ceph's health as Rook last saw it, from the
 * CephCluster status (no exec needed).
 */

export interface BadgeCheck {
  code: string;
  severity: string;
  message: string;
}

export function summarize(cc: any): { status: string; checks: BadgeCheck[]; text: string; checked?: string } {
  const st = cc?.status?.ceph ?? {};
  const status: string = st.health ?? 'HEALTH_UNKNOWN';
  const checks: BadgeCheck[] = Object.entries(st.details ?? {}).map(([code, d]: [string, any]) => ({
    code,
    severity: d?.severity ?? 'HEALTH_WARN',
    message: d?.message ?? code,
  }));
  const errs = checks.filter(c => c.severity === 'HEALTH_ERR').length;
  const warns = checks.length - errs;
  const parts = [errs ? `${errs} error${errs > 1 ? 's' : ''}` : '', warns ? `${warns} warning${warns > 1 ? 's' : ''}` : ''].filter(Boolean);
  const text = status === 'HEALTH_OK' ? 'Ceph healthy' : parts.length ? `Ceph: ${parts.join(', ')}` : status === 'HEALTH_UNKNOWN' ? 'Ceph: unknown' : `Ceph: ${status}`;
  return { status, checks, text, checked: st.lastChecked };
}

