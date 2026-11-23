import { Obj } from '../../model/types';
import { daemonId, daemonType, mixedVersions, monRestartSafety, podImage, podState, restarts } from './pods';

const pod = (labels: Record<string, string>, status: any = { phase: 'Running', containerStatuses: [{ ready: true, restartCount: 2 }] }, name = 'p'): Obj => ({
  metadata: { name, namespace: 'rook-ceph', labels },
  spec: { containers: [{ image: 'quay.io/ceph/ceph:v20.2.4' }] },
  status,
});

describe('daemon pods', () => {
  it('classifies Rook pods (real labels)', () => {
    expect(daemonType(pod({ app: 'rook-ceph-mon', ceph_daemon_type: 'mon', mon: 'a', ceph_daemon_id: 'a' }))).toBe('mon');
    expect(daemonType(pod({ app: 'rook-ceph-osd', ceph_daemon_type: 'osd', 'ceph-osd-id': '0' }))).toBe('osd');
    expect(daemonType(pod({ app: 'rook-ceph-osd-prepare' }))).toBe('osd-prepare');
    expect(daemonType(pod({ app: 'rook-ceph-exporter', ceph_daemon_id: 'exporter' }))).toBe('exporter');
    expect(daemonType(pod({ app: 'rook-ceph.rbd.csi.ceph.com-nodeplugin' }))).toBe('csi');
    expect(daemonType(pod({ 'app.kubernetes.io/name': 'ceph-csi' }, undefined, 'ceph-csi-controller-manager-x'))).toBe('csi');
    expect(daemonType(pod({ app: 'rook-ceph-operator' }))).toBe('operator');
    expect(daemonType(pod({ app: 'rook-ceph-rgw', ceph_daemon_type: 'rgw' }))).toBe('rgw');
    expect(daemonType(pod({}))).toBe('other');
  });

  it('reads state, restarts, image and id', () => {
    const p = pod({ app: 'rook-ceph-mon', ceph_daemon_id: 'b' });
    expect(podState(p)).toEqual({ word: 'Running', tone: 'ok' });
    expect(restarts(p)).toBe(2);
    expect(podImage(p)).toEqual({ image: 'quay.io/ceph/ceph:v20.2.4', tag: 'v20.2.4' });
    expect(daemonId(p)).toBe('b');
    expect(podState(pod({}, { phase: 'Succeeded' })).word).toBe('Completed');
    expect(podState(pod({}, { phase: 'Running', containerStatuses: [{ ready: false, state: { waiting: { reason: 'CrashLoopBackOff' } } }] }))).toEqual({
      word: 'CrashLoopBackOff',
      tone: 'err',
    });
  });

  it('spots mixed versions', () => {
    expect(mixedVersions({ mon: { '20.2.4 tentacle': 3 }, overall: { '20.2.4 tentacle': 7 } })).toEqual([]);
    expect(mixedVersions({ mon: { '20.2.4 tentacle': 2, '19.2.3 squid': 1 }, overall: { '20.2.4 tentacle': 6, '19.2.3 squid': 1 } })).toHaveLength(2);
  });

  it('says when a monitor restart is safe', () => {
    expect(monRestartSafety(3, 3).safe).toBe(true);
    expect(monRestartSafety(3, 2).safe).toBe(false);
    expect(monRestartSafety(5, 4).safe).toBe(true);
    expect(monRestartSafety(3, 1).text).toMatch(/quorum is lost/);
  });
});
