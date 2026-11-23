import { eventRow, eventRows, filterEvents, sortEvents, warningReasons } from './events';
import { Obj } from './types';

const ev = (name: string, type: string, reason: string, last: string, extra: any = {}): Obj => ({
  metadata: { name, namespace: 'rook-ceph', uid: name, creationTimestamp: '2026-11-23T00:00:00Z' },
  type,
  reason,
  message: `${reason} happened `,
  involvedObject: { kind: 'Pod', name: `pod-${name}`, namespace: 'rook-ceph' },
  lastTimestamp: last,
  firstTimestamp: '2026-11-23T00:00:00Z',
  count: 1,
  source: { component: 'kubelet' },
  ...extra,
});

describe('events', () => {
  const raw = [
    ev('a', 'Normal', 'Pulled', '2026-11-23T03:00:00Z'),
    ev('b', 'Warning', 'BackOff', '2026-11-23T01:00:00Z', { count: 12 }),
    ev('c', 'Normal', 'Created', '2026-11-23T03:30:00Z'),
    ev('d', 'Warning', 'FailedMount', '2026-11-23T02:00:00Z'),
    // events.k8s.io shape: eventTime + series, regarding, note.
    {
      metadata: { name: 'e', namespace: 'rook-ceph', uid: 'e' },
      type: 'Warning',
      reason: 'BackOff',
      note: 'Back-off restarting',
      regarding: { kind: 'Pod', name: 'osd-0' },
      eventTime: '2026-11-23T00:30:00Z',
      series: { count: 3, lastObservedTime: '2026-11-23T02:30:00Z' },
      reportingController: 'kubelet',
    },
  ];

  it('reads both event shapes', () => {
    const r = eventRow(raw[4]);
    expect(r).toMatchObject({ type: 'Warning', reason: 'BackOff', objectKind: 'Pod', objectName: 'osd-0', message: 'Back-off restarting', count: 3, source: 'kubelet' });
    expect(r.last).toBe(Date.parse('2026-11-23T02:30:00Z'));
    expect(eventRow(raw[0]).message).toBe('Pulled happened');
  });

  it('puts warnings first, newest first', () => {
    expect(eventRows(raw).map(r => r.key)).toEqual(['e', 'd', 'b', 'c', 'a']);
    expect(sortEvents([])).toEqual([]);
  });

  it('filters by type, words and age', () => {
    const rows = eventRows(raw);
    expect(filterEvents(rows, { type: 'Warning' })).toHaveLength(3);
    expect(filterEvents(rows, { q: 'mount pod-d' }).map(r => r.key)).toEqual(['d']);
    const now = Date.parse('2026-11-23T03:40:00Z');
    expect(filterEvents(rows, { sinceMs: 3600000, now }).map(r => r.key)).toEqual(['c', 'a']);
  });

  it('sums warnings by reason', () => {
    expect(warningReasons(eventRows(raw))).toEqual([
      { reason: 'BackOff', count: 15 },
      { reason: 'FailedMount', count: 1 },
    ]);
  });
});
