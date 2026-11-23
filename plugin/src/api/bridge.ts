/*
 * Runs Ceph commands through the exec bridge (src/api/bridgeScript.ts):
 * finds a Rook pod with the admin keyring (the toolbox, else the
 * operator), opens an exec WebSocket the way Headlamp opens its own
 * streams (so it authenticates like the rest of Headlamp: kubeconfig, or
 * the HttpOnly cookie of a token login), sends the program and the batch on
 * stdin and reads one JSON answer.
 *
 * Every batch is one exec, so it appears in the API server's audit log
 * under the user who ran it, and Kubernetes RBAC (create pods/exec in the
 * Rook namespace) decides who may use it. No Ceph secret reaches the
 * browser.
 */

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { BridgeResult, ExecCollector, parseAnswer, resultError, stdinFrame } from '../model/exec';
import { BOOTSTRAP, BRIDGE_PY } from './bridgeScript';
import { currentCluster, kget } from './client';
import { can } from './permissions';

export type CephQuery = (
  | { t: 'mon' | 'mgr'; cmd: Record<string, unknown>; in?: string; timeout?: number }
  | { t: 'osd'; id: number; cmd: Record<string, unknown>; in?: string; timeout?: number }
  | { t: 'cli'; bin: 'rbd' | 'radosgw-admin'; args: (string | number)[]; timeout?: number }
  | {
      t: 'rbd_images';
      pool: string;
      ns?: string;
      images?: string[];
      trash?: boolean;
      namespaces?: boolean;
      watchers?: boolean;
    }
) & {
  /** Keep only these top-level fields of the answer (mgr dump is 100 KB). */
  keys?: string[];
};

/** Shorthands. */
export const mon = (prefix: string, args: Record<string, unknown> = {}): CephQuery => ({ t: 'mon', cmd: { prefix, ...args } });
export const mgr = (prefix: string, args: Record<string, unknown> = {}): CephQuery => ({ t: 'mgr', cmd: { prefix, ...args } });

export interface BridgeTarget {
  kind: 'toolbox' | 'operator';
  namespace: string;
  pod: string;
  container: string;
  /** Ceph configuration file and keyring inside that pod. */
  conf: string;
  keyring?: string;
}

export type BridgeState =
  | { status: 'ready'; target: BridgeTarget }
  | { status: 'forbidden'; namespace: string; reason: string }
  | { status: 'unavailable'; namespace: string; reason: string };

export class CephError extends Error {
  code: number;
  /** The exec never started (pod gone, refused): safe to retry elsewhere. */
  notStarted: boolean;
  constructor(message: string, code = -1, notStarted = false) {
    super(message);
    this.code = code;
    this.notStarted = notStarted;
  }
}

const running = (p: any) =>
  p?.status?.phase === 'Running' && !p.metadata?.deletionTimestamp && (p.status?.containerStatuses ?? []).every((c: any) => c.ready);

async function firstRunning(namespace: string | null, selector: string): Promise<any | null> {
  const path = namespace ? `/api/v1/namespaces/${namespace}/pods` : '/api/v1/pods';
  try {
    const list = await kget(path, { labelSelector: selector });
    return (list?.items ?? []).find(running) ?? null;
  } catch {
    return null;
  }
}

/**
 * Where to run commands for the CephCluster in `clusterNs`: the toolbox
 * (app=rook-ceph-tools) if it runs, else the operator pod (the way the
 * `kubectl rook-ceph` plugin does), in the cluster namespace or, if
 * allowed, anywhere.
 */
export async function findTarget(clusterNs: string, prefer: 'auto' | 'toolbox' | 'operator' = 'auto'): Promise<BridgeState> {
  const tools = prefer !== 'operator' ? await firstRunning(clusterNs, 'app=rook-ceph-tools') : null;
  let target: BridgeTarget | null = null;
  if (tools) {
    target = {
      kind: 'toolbox',
      namespace: clusterNs,
      pod: tools.metadata.name,
      container: tools.spec?.containers?.[0]?.name ?? 'rook-ceph-tools',
      conf: '/etc/ceph/ceph.conf',
    };
  } else if (prefer !== 'toolbox') {
    const op = (await firstRunning(clusterNs, 'app=rook-ceph-operator')) ?? (await firstRunning(null, 'app=rook-ceph-operator'));
    if (op) {
      target = {
        kind: 'operator',
        namespace: op.metadata.namespace,
        pod: op.metadata.name,
        container: op.spec?.containers?.find((c: any) => c.name === 'rook-ceph-operator')?.name ?? op.spec?.containers?.[0]?.name,
        conf: `/var/lib/rook/${clusterNs}/${clusterNs}.config`,
        keyring: `/var/lib/rook/${clusterNs}/client.admin.keyring`,
      };
    }
  }
  if (!target) {
    return {
      status: 'unavailable',
      namespace: clusterNs,
      reason:
        prefer === 'toolbox'
          ? `No running Rook toolbox (app=rook-ceph-tools) in ${clusterNs}.`
          : `Neither a Rook toolbox nor the Rook operator is running where Cairn can see it (namespace ${clusterNs}).`,
    };
  }
  const ok = await can({ verb: 'create', group: '', resource: 'pods', subresource: 'exec', namespace: target.namespace });
  if (!ok) {
    return {
      status: 'forbidden',
      namespace: target.namespace,
      reason: `Your role may not run commands in pods of ${target.namespace} (create pods/exec). Cairn needs it to read Ceph's live state and to run Ceph operations.`,
    };
  }
  return { status: 'ready', target };
}

/* ---------------------------------------------------------------- exec */

const MAX_PARALLEL = 3;
let active = 0;
const waiting: (() => void)[] = [];

function slot(): Promise<() => void> {
  return new Promise(resolve => {
    const take = () => {
      active++;
      resolve(() => {
        active--;
        waiting.shift()?.();
      });
    };
    if (active < MAX_PARALLEL) take();
    else waiting.push(take);
  });
}

/** One exec of the bridge with this batch. Resolves with every result, in order. */
export async function execBridge(target: BridgeTarget, cmds: CephQuery[], timeoutMs = 45000): Promise<BridgeResult[]> {
  const release = await slot();
  try {
    return await execOnce(target, cmds, timeoutMs);
  } finally {
    release();
  }
}

function execOnce(target: BridgeTarget, cmds: CephQuery[], timeoutMs: number): Promise<BridgeResult[]> {
  const q = BOOTSTRAP.map(c => `&command=${encodeURIComponent(c)}`).join('');
  const path =
    `/api/v1/namespaces/${target.namespace}/pods/${target.pod}/exec?container=${encodeURIComponent(target.container)}` +
    `${q}&stdin=true&stdout=true&stderr=true&tty=false`;
  const request = JSON.stringify({ conf: target.conf, keyring: target.keyring ?? '', cmds, timeout: 15 });
  const frame = stdinFrame(BRIDGE_PY, request);
  return new Promise((resolve, reject) => {
    const col = new ExecCollector();
    let done = false;
    let sent = false;
    let opened = false;
    let handle: { cancel: () => void; getSocket: () => WebSocket | null } | null = null;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      try {
        handle?.cancel();
      } catch {
        /* already closed */
      }
      if (err) return reject(err);
      try {
        const a = parseAnswer(col.stdout(), col.stderr());
        resolve(a.res);
      } catch (e) {
        const code = col.exitCode();
        reject(new CephError(code && code > 0 ? `${(e as Error).message} (exit ${code})` : (e as Error).message));
      }
    };
    const timer = window.setTimeout(() => finish(new CephError('Ceph did not answer in time')), timeoutMs);
    const send = (s: WebSocket) => {
      if (sent) return;
      sent = true;
      opened = true;
      s.send(frame);
    };
    const onClose = () => {
      if (!opened && col.frames === 0) {
        finish(
          new CephError(
            `Could not run commands in pod ${target.namespace}/${target.pod}: the exec was refused or the pod is gone.`,
            -1,
            true
          )
        );
        return;
      }
      finish();
    };
    handle = (ApiProxy as any).stream(path, (data: unknown) => col.push(data), {
      isJson: false,
      additionalProtocols: ['v4.channel.k8s.io'],
      reconnectOnFailure: false,
      failCb: onClose,
      cluster: currentCluster(),
    });
    // stream() creates the socket asynchronously; send stdin once it is open.
    const poll = window.setInterval(() => {
      const s = handle?.getSocket();
      if (!s) return;
      window.clearInterval(poll);
      if (s.readyState === WebSocket.OPEN) send(s);
      else s.addEventListener('open', () => send(s));
    }, 15);
  });
}

/* -------------------------------------------------------------- facade */

let state: { key: string; p: Promise<BridgeState>; at: number } | null = null;
const STATE_TTL = 60000;

/** The bridge for this cluster namespace (cached a minute; `fresh` forces a new look). */
export function bridgeFor(clusterNs: string, prefer: 'auto' | 'toolbox' | 'operator' = 'auto', fresh = false): Promise<BridgeState> {
  const key = `${currentCluster()}|${clusterNs}|${prefer}`;
  if (!fresh && state && state.key === key && Date.now() - state.at < STATE_TTL) return state.p;
  const p = findTarget(clusterNs, prefer);
  state = { key, p, at: Date.now() };
  return p;
}

/**
 * Runs a batch on the cluster's bridge. When the exec could not start (a
 * restarted operator, a new toolbox pod) the pod is looked up again once;
 * a batch that started is never repeated (commands may not be idempotent).
 */
export async function cephBatch(clusterNs: string, cmds: CephQuery[], opts: { timeoutMs?: number; prefer?: 'auto' | 'toolbox' | 'operator' } = {}): Promise<BridgeResult[]> {
  let st = await bridgeFor(clusterNs, opts.prefer);
  if (st.status !== 'ready') throw new CephError(st.reason, -13);
  try {
    return await execBridge(st.target, cmds, opts.timeoutMs);
  } catch (e) {
    if (!(e instanceof CephError) || !e.notStarted) throw e;
    st = await bridgeFor(clusterNs, opts.prefer, true);
    if (st.status !== 'ready') throw new CephError(st.reason, -13);
    return execBridge(st.target, cmds, opts.timeoutMs);
  }
}

/** One command; throws a CephError with Ceph's message when it fails. */
export async function ceph<T = any>(clusterNs: string, q: CephQuery, opts: { timeoutMs?: number } = {}): Promise<{ out: T; message: string }> {
  const [res] = await cephBatch(clusterNs, [q], opts);
  if (!res || res.r !== 0) throw new CephError(res ? resultError(res) : 'No answer', res?.r ?? -1);
  return { out: res.out as T, message: (res.err || '').trim() };
}
