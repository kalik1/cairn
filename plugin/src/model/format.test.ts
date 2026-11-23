import { ago, bytes, cephTime, count, duration, ms, ops, parseSize, pct, plural, rate } from './format';

describe('format', () => {
  it('formats bytes in IEC units', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(1023)).toBe('1023 B');
    expect(bytes(1536)).toBe('1.50 KiB');
    expect(bytes(257698037760)).toBe('240 GiB');
    expect(bytes(27134017536)).toBe('25.3 GiB');
    expect(bytes(undefined)).toBe('—');
  });
  it('formats rates, ops, counts, percentages, latency', () => {
    expect(rate(6484)).toBe('6.33 KiB/s');
    expect(ops(7)).toBe('7 op/s');
    expect(ops(2.25)).toBe('2.3 op/s');
    expect(ops(15400)).toBe('15k op/s');
    expect(count(2576)).toBe('2,576');
    expect(count(25760)).toBe('25.8k');
    expect(pct(0.10529)).toBe('10.5%');
    expect(pct(0.0000082)).toBe('<0.1%');
    expect(ms(9)).toBe('9.0 ms');
    expect(ms(1500)).toBe('1.5 s');
  });
  it('formats durations', () => {
    expect(duration(45)).toBe('45 s');
    expect(duration(5250)).toBe('1 h 27 min');
    expect(duration(3 * 86400 + 7200)).toBe('3 d 2 h');
  });
  it('parses Ceph times', () => {
    expect(cephTime('2026-11-23T01:16:30.570445+0000')).toBe(Date.parse('2026-11-23T01:16:30.570Z'));
    expect(cephTime('2026-11-22T23:42:05:508841+0000')).toBe(Date.parse('2026-11-22T23:42:05.508Z'));
    expect(cephTime(1795390971.1181164)).toBe(1795390971118.1164);
    expect(cephTime('2026-11-23T01:15:41.653206Z')).toBe(Date.parse('2026-11-23T01:15:41.653Z'));
    expect(cephTime('')).toBeNull();
    expect(cephTime('2026-11-23 01:15:41.653206')).not.toBeNull();
  });
  it('says how long ago', () => {
    expect(ago(1000, 3000)).toBe('just now');
    expect(ago(0, 3600 * 1000)).toBe('1 h ago');
  });
  it('parses sizes', () => {
    expect(parseSize('10G')).toBe(10 * 1024 ** 3);
    expect(parseSize('10 GiB')).toBe(10 * 1024 ** 3);
    expect(parseSize('1.5T')).toBe(1.5 * 1024 ** 4);
    expect(parseSize('4096')).toBe(4096);
    expect(parseSize('ten')).toBeNull();
  });
  it('pluralizes', () => {
    expect(plural(1, 'OSD')).toBe('1 OSD');
    expect(plural(3, 'OSD')).toBe('3 OSDs');
  });
});
