import { summarize } from './badge';

describe('app-bar health summary', () => {
  it('counts warnings and errors from the CephCluster status', () => {
    const s = summarize({
      status: {
        ceph: {
          health: 'HEALTH_ERR',
          lastChecked: '2026-11-23T02:34:38Z',
          details: {
            OSD_DOWN: { severity: 'HEALTH_WARN', message: '1 osds down' },
            PG_AVAILABILITY: { severity: 'HEALTH_ERR', message: 'Reduced data availability' },
            AUTH_INSECURE_KEYS_ALLOWED: { severity: 'HEALTH_WARN', message: 'insecure' },
          },
        },
      },
    });
    expect(s.text).toBe('Ceph: 1 error, 2 warnings');
    expect(s.checks).toHaveLength(3);
    expect(s.checked).toBe('2026-11-23T02:34:38Z');
  });

  it('says healthy, or unknown before Rook reported', () => {
    expect(summarize({ status: { ceph: { health: 'HEALTH_OK' } } }).text).toBe('Ceph healthy');
    expect(summarize({ status: {} }).text).toBe('Ceph: unknown');
    expect(summarize(null).status).toBe('HEALTH_UNKNOWN');
  });
});
