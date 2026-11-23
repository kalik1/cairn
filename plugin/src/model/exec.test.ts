import { ExecCollector, parseAnswer, resultError, splitFrame, stdinFrame } from './exec';

const frame = (ch: number, s: string) => {
  const b = new TextEncoder().encode(s);
  const u = new Uint8Array(b.length + 1);
  u[0] = ch;
  u.set(b, 1);
  return u.buffer;
};

describe('exec framing', () => {
  it('builds the stdin frame with length header', () => {
    const f = stdinFrame('print(1)', '{"a":1}');
    expect(f[0]).toBe(0);
    expect(new TextDecoder().decode(f.subarray(1))).toBe('8\nprint(1){"a":1}\n');
  });

  it('splits frames by channel', () => {
    expect(splitFrame(frame(1, 'x'))?.channel).toBe(1);
    expect(splitFrame(new ArrayBuffer(0))).toBeNull();
    expect(splitFrame(42)).toBeNull();
  });

  it('collects stdout across frames and reads the exit status', () => {
    const c = new ExecCollector();
    c.push(frame(1, '{"v":1,'));
    c.push(frame(2, 'warn'));
    c.push(frame(1, '"res":[]}'));
    c.push(frame(3, '{"metadata":{},"status":"Success"}'));
    expect(c.stdout()).toBe('{"v":1,"res":[]}');
    expect(c.stderr()).toBe('warn');
    expect(c.exitCode()).toBe(0);
  });

  it('reads a non-zero exit code', () => {
    const c = new ExecCollector();
    c.push(frame(3, '{"status":"Failure","reason":"NonZeroExitCode","details":{"causes":[{"reason":"ExitCode","message":"2"}]}}'));
    expect(c.exitCode()).toBe(2);
  });

  it('decodes UTF-8 split across frames', () => {
    const c = new ExecCollector();
    const b = new TextEncoder().encode('é');
    c.push(new Uint8Array([1, b[0]]).buffer);
    c.push(new Uint8Array([1, b[1]]).buffer);
    expect(c.stdout()).toBe('é');
  });
});

describe('bridge answers', () => {
  it('parses results', () => {
    const a = parseAnswer('{"v":1,"res":[{"r":0,"out":{"x":1},"err":""}]}', '');
    expect(a.res[0].out.x).toBe(1);
  });
  it('turns a fatal connection error into an exception', () => {
    expect(() => parseAnswer('{"v":1,"res":[],"fatal":"TimedOut: x"}', '')).toThrow(/Cannot reach Ceph/);
  });
  it('explains empty output with stderr', () => {
    expect(() => parseAnswer('', 'Traceback\nModuleNotFoundError: rados')).toThrow(/rados/);
  });
  it('words a failed result', () => {
    expect(resultError({ r: -2, out: null, err: '' })).toMatch(/not found/);
    expect(resultError({ r: -16, out: null, err: 'pool is busy' })).toBe('pool is busy');
  });
});
