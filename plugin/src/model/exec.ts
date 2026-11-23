/*
 * Pure helpers for the exec bridge: the Kubernetes channel framing of a
 * `v4.channel.k8s.io` exec WebSocket and the bridge's JSON answer.
 *
 * Frames are binary: the first byte is the channel (0 stdin, 1 stdout,
 * 2 stderr, 3 error/status), the rest is data. The status frame carries a
 * metav1.Status ({"status":"Success"} or a Failure with the exit code).
 */

export const STDIN = 0;
export const STDOUT = 1;
export const STDERR = 2;
export const STATUS = 3;

const enc = new TextEncoder();

/** One stdin frame with the bootstrap header, the program and the request line. */
export function stdinFrame(program: string, requestJson: string): Uint8Array {
  const payload = enc.encode(`${program.length}\n${program}${requestJson}\n`);
  const out = new Uint8Array(payload.length + 1);
  out[0] = STDIN;
  out.set(payload, 1);
  return out;
}

/** Channel and bytes of a received frame (ArrayBuffer, typed array or string). */
export function splitFrame(data: unknown): { channel: number; bytes: Uint8Array } | null {
  let u: Uint8Array;
  if (data instanceof ArrayBuffer) u = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) u = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else if (typeof data === 'string') u = enc.encode(data);
  else return null;
  if (u.length === 0) return null;
  return { channel: u[0], bytes: u.subarray(1) };
}

/** Accumulates stdout/stderr/status frames of one exec. */
export class ExecCollector {
  private out: Uint8Array[] = [];
  private errs: Uint8Array[] = [];
  status: any = null;
  frames = 0;

  push(data: unknown) {
    const f = splitFrame(data);
    if (!f) return;
    this.frames++;
    if (f.channel === STDOUT) this.out.push(f.bytes.slice());
    else if (f.channel === STDERR) this.errs.push(f.bytes.slice());
    else if (f.channel === STATUS) {
      const txt = new TextDecoder().decode(f.bytes);
      try {
        this.status = JSON.parse(txt);
      } catch {
        this.status = { status: 'Failure', message: txt };
      }
    }
  }

  private join(parts: Uint8Array[]): string {
    const len = parts.reduce((n, p) => n + p.length, 0);
    const all = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    return new TextDecoder().decode(all);
  }

  stdout(): string {
    return this.join(this.out);
  }

  stderr(): string {
    return this.join(this.errs);
  }

  /** The exit code from the status frame (0 on Success, null when unknown). */
  exitCode(): number | null {
    if (!this.status) return null;
    if (this.status.status === 'Success') return 0;
    const cause = this.status.details?.causes?.find((c: any) => c.reason === 'ExitCode');
    return cause ? Number(cause.message) : -1;
  }
}

export interface BridgeResult<T = any> {
  /** Ceph return code: 0 ok, negative errno otherwise. */
  r: number;
  out: T;
  /** Ceph's status string (often the human message of a command). */
  err: string;
  ms?: number;
}

export interface BridgeAnswer {
  v: number;
  res: BridgeResult[];
  fatal?: string;
}

/** Parses the bridge's stdout; throws a readable error for anything else. */
export function parseAnswer(stdout: string, stderr: string): BridgeAnswer {
  const txt = stdout.trim();
  if (!txt) {
    const why = stderr.trim().split('\n').slice(-3).join(' ');
    throw new Error(why ? `The Ceph bridge printed nothing: ${why}` : 'The Ceph bridge printed nothing');
  }
  let a: BridgeAnswer;
  try {
    a = JSON.parse(txt);
  } catch {
    throw new Error(`The Ceph bridge answered something unexpected: ${txt.slice(0, 200)}`);
  }
  if (a.fatal) throw new Error(`Cannot reach Ceph: ${a.fatal}`);
  if (!Array.isArray(a.res)) throw new Error('The Ceph bridge answered without results');
  return a;
}

/** Errno names for the codes Ceph commands return most. */
const ERRNO: Record<number, string> = {
  1: 'operation not permitted',
  2: 'not found',
  5: 'I/O error',
  11: 'try again',
  13: 'permission denied',
  16: 'busy',
  17: 'already exists',
  22: 'invalid argument',
  39: 'not empty',
  95: 'not supported',
  110: 'timed out',
};

export function errnoText(r: number): string {
  return ERRNO[Math.abs(r)] ?? `error ${r}`;
}

/** A readable message for a failed bridge result. */
export function resultError(res: BridgeResult): string {
  const msg = (res.err || '').trim();
  if (msg) return msg;
  return `Ceph refused the command (${errnoText(res.r)})`;
}
