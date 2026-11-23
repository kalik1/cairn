/*
 * RBD operations: each one is an `rbd` command run by the bridge (no
 * shell, arguments as a list), recorded in Activity. After it, the
 * cached image lists of the pool are refreshed. Callers check the safety
 * rules (src/model/rbd.ts) and confirm first; these functions only run.
 */

import { imageSpec, snapSpec } from '../model/rbd';
import { runOp } from './activity';
import { invalidateCephQueries, runCeph } from './ceph';

const MiB = 1024 * 1024;

/** Cache key prefix of a pool's RBD queries (lists, du, image pages). */
export const rbdKey = (pool: string) => `rbd:${pool}:`;

/** Size for the rbd tool, in whole MiB (rounded up). */
export const rbdSize = (bytes: number) => `${Math.max(1, Math.ceil(bytes / MiB))}M`;

export interface RbdWhere {
  /** Namespace of the CephCluster (where the bridge runs). */
  cluster: string;
  pool: string;
  /** RADOS namespace ("" = default). */
  ns: string;
}

async function rbd(w: RbdWhere, title: string, target: string, args: (string | number)[], timeoutSec = 300): Promise<string> {
  try {
    return await runOp({
      title,
      target,
      detail: `rbd ${args.join(' ')}`,
      run: () => runCeph(w.cluster, { t: 'cli', bin: 'rbd', args, timeout: timeoutSec }, (timeoutSec + 15) * 1000),
    });
  } finally {
    invalidateCephQueries(rbdKey(w.pool));
  }
}

const nsArgs = (ns: string) => (ns ? ['--namespace', ns] : []);

export const rbdOps = {
  create(w: RbdWhere, name: string, size: number, features: string[], dataPool?: string) {
    const spec = imageSpec(w.pool, w.ns, name);
    return rbd(w, `Create image ${spec}`, `image ${spec}`, [
      'create',
      '--size',
      rbdSize(size),
      ...(features.length ? ['--image-feature', features.join(',')] : []),
      ...(dataPool ? ['--data-pool', dataPool] : []),
      '--no-progress',
      spec,
    ]);
  },
  grow(w: RbdWhere, image: string, size: number) {
    const spec = imageSpec(w.pool, w.ns, image);
    return rbd(w, `Grow ${spec} to ${rbdSize(size)}`, `image ${spec}`, ['resize', '--size', rbdSize(size), '--no-progress', spec]);
  },
  snapCreate(w: RbdWhere, image: string, snap: string) {
    const s = snapSpec(w.pool, w.ns, image, snap);
    return rbd(w, `Snapshot ${s}`, `image ${imageSpec(w.pool, w.ns, image)}`, ['snap', 'create', '--no-progress', s]);
  },
  snapRollback(w: RbdWhere, image: string, snap: string) {
    const s = snapSpec(w.pool, w.ns, image, snap);
    return rbd(w, `Roll back ${imageSpec(w.pool, w.ns, image)} to ${snap}`, `image ${imageSpec(w.pool, w.ns, image)}`, ['snap', 'rollback', '--no-progress', s], 1800);
  },
  snapRemove(w: RbdWhere, image: string, snap: string) {
    const s = snapSpec(w.pool, w.ns, image, snap);
    return rbd(w, `Delete snapshot ${s}`, `image ${imageSpec(w.pool, w.ns, image)}`, ['snap', 'rm', '--no-progress', s]);
  },
  snapProtect(w: RbdWhere, image: string, snap: string, on: boolean) {
    const s = snapSpec(w.pool, w.ns, image, snap);
    return rbd(w, `${on ? 'Protect' : 'Unprotect'} snapshot ${s}`, `image ${imageSpec(w.pool, w.ns, image)}`, ['snap', on ? 'protect' : 'unprotect', s]);
  },
  clone(w: RbdWhere, image: string, snap: string, to: { pool: string; ns: string; name: string }) {
    const src = snapSpec(w.pool, w.ns, image, snap);
    const dst = imageSpec(to.pool, to.ns, to.name);
    return rbd(w, `Clone ${src} to ${dst}`, `image ${dst}`, ['clone', src, dst]).finally(() => invalidateCephQueries(rbdKey(to.pool)));
  },
  flatten(w: RbdWhere, image: string) {
    const spec = imageSpec(w.pool, w.ns, image);
    return rbd(w, `Flatten ${spec}`, `image ${spec}`, ['flatten', '--no-progress', spec], 1800);
  },
  trashMove(w: RbdWhere, image: string) {
    const spec = imageSpec(w.pool, w.ns, image);
    return rbd(w, `Move ${spec} to the trash`, `image ${spec}`, ['trash', 'mv', spec]);
  },
  trashRestore(w: RbdWhere, id: string, name: string) {
    return rbd(w, `Restore ${imageSpec(w.pool, w.ns, name)} from the trash`, `image ${imageSpec(w.pool, w.ns, name)}`, [
      'trash',
      'restore',
      '--pool',
      w.pool,
      ...nsArgs(w.ns),
      id,
    ]);
  },
  trashRemove(w: RbdWhere, id: string, name: string, force: boolean) {
    return rbd(w, `Remove ${imageSpec(w.pool, w.ns, name)} from the trash for good`, `image ${imageSpec(w.pool, w.ns, name)}`, [
      'trash',
      'rm',
      '--no-progress',
      ...(force ? ['--force'] : []),
      '--pool',
      w.pool,
      ...nsArgs(w.ns),
      id,
    ]);
  },
  trashPurge(w: RbdWhere) {
    const spec = w.ns ? `${w.pool}/${w.ns}` : w.pool;
    return rbd(w, `Purge the RBD trash of ${spec}`, `pool ${w.pool}`, ['trash', 'purge', '--no-progress', spec], 1800);
  },
};
