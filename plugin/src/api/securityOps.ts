/*
 * Cephx reads and changes. Reads: auth ls (entities and caps) and auth
 * dump-keys (the real key type of each entity); the bridge blanks every
 * key and refuses the commands that print them. Changes are CephCluster or
 * CephClient spec edits through the change preview, behind a typed
 * confirmation: Rook rotates the keys and sets the ciphers, Cairn never
 * runs "ceph auth rotate" or "ceph mon set" itself.
 */

import {
  cephClientUser,
  disallowAes,
  dropPriorCsiKeys,
  muteThroughRook,
  rotateClientKey,
  rotateCsiKeys,
  rotateDaemonKeys,
  rotateMirrorPeerKey,
} from '../model/cephx';
import { Obj } from '../model/types';
import { previewChange } from '../ui/ChangeDialog';
import { pathOf } from './apply';
import { CephQuery, mon } from './bridge';
import { invalidateCephQueries } from './ceph';
import { kget } from './client';

export const SECURITY_KEY = 'security';

export const authQueries: CephQuery[] = [mon('auth ls'), mon('auth dump-keys')];

export const ROOK_CEPHX_DOC = 'https://rook.io/docs/rook/v1.21/Storage-Configuration/Advanced/cephx-key-rotation/';
export const CEPH_CVE_DOC = 'https://docs.ceph.com/en/latest/security/CVE-2025-30156/';
export const GHSA_DOC = 'https://github.com/ceph/ceph/security/advisories/GHSA-7q3q-3975-qw3q';
export const HEALTH_DOC = 'https://docs.ceph.com/en/tentacle/rados/operations/health-checks/';
export const AUTH_CONFIG_DOC = 'https://docs.ceph.com/en/tentacle/rados/configuration/auth-config-ref/';

const done = (onDone?: () => void) => () => {
  invalidateCephQueries(SECURITY_KEY);
  onDone?.();
};

const name = (c: Obj) => c.metadata.name;

/**
 * The object as the API server has it now. Rook rewrites the CephCluster
 * status every minute, so the copy from the (polled) list is often stale
 * and an update with its resourceVersion would be refused (409).
 */
async function fresh(o: Obj): Promise<Obj> {
  try {
    const cur = await kget<Obj>(pathOf(o));
    return cur?.metadata?.name ? cur : o;
  } catch {
    return o;
  }
}

export async function rotateDaemons(stale: Obj, onDone?: () => void): Promise<boolean> {
  const cluster = await fresh(stale);
  const { after, generation } = rotateDaemonKeys(cluster);
  return previewChange({
    title: 'Rotate the daemon keys to aes256k',
    op: 'update',
    before: cluster,
    after,
    danger: true,
    warning:
      'Rook rotates the key of every Ceph daemon: mons, mgrs, OSDs, MDS, RGW, NFS, the crash collector, the exporter and client.admin. Most daemons restart one after the other; do it in a quiet hour.',
    consequences: [
      `Rook sets daemon.keyRotationPolicy KeyGeneration with keyGeneration ${generation}; on Ceph 20.2.4 / 19.2.6 or later the new keys are aes256k.`,
      'It first makes aes256k the preferred cipher, rotates client.admin through a temporary client.admin-rotator user, then the mons, then the other daemons; service tickets switch to aes256k once the OSDs reconcile.',
      'Volumes stay attached: Kubernetes PVCs keep working during the rotation.',
      'It is done when status.cephx of the CephCluster reports this generation for admin, mon, mgr, osd, crash collector and exporter, and auth dump-keys lists them as aes256k. AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE clears 2 to 3 hours later.',
      'Risk: a daemon that cannot restart (no room on its node, a broken disk) stays on its old key until it does.',
    ],
    typeToConfirm: name(cluster),
    action: 'Rotate daemon keys',
    target: `cephcluster ${name(cluster)}`,
    onDone: done(onDone),
  });
}

export async function rotateCsi(stale: Obj, onDone?: () => void): Promise<boolean> {
  const cluster = await fresh(stale);
  const { after, generation } = rotateCsiKeys(cluster, 1);
  return previewChange({
    title: 'Rotate the Ceph-CSI keys to aes256k',
    op: 'update',
    before: cluster,
    after,
    danger: true,
    warning:
      'Ceph-CSI 3.17.1 or later and a host kernel 7.0 or later on every node (7.2 with FIPS) are needed: an older kernel cannot mount volumes with an aes256k key.',
    consequences: [
      `Rook creates generation ${generation} of the CSI keys as aes256k and keeps the previous generation (keepPriorKeyCountMax 1) for volumes mounted now.`,
      'New mounts use the new keys at once; volumes already mounted keep the old key until their node is drained.',
      'Then, node by node: cordon, drain, reboot if needed, uncordon. When every node is done, stop keeping the prior keys (keepPriorKeyCountMax 0).',
      'To go back: set csi.keyType to aes with a new keyGeneration.',
    ],
    typeToConfirm: name(cluster),
    action: 'Rotate Ceph-CSI keys',
    target: `cephcluster ${name(cluster)}`,
    onDone: done(onDone),
  });
}

export async function dropPriorCsi(stale: Obj, onDone?: () => void): Promise<boolean> {
  const cluster = await fresh(stale);
  return previewChange({
    title: 'Stop keeping the prior Ceph-CSI keys',
    op: 'update',
    before: cluster,
    after: dropPriorCsiKeys(cluster),
    danger: true,
    warning: 'Only after every node was drained and uncordoned since the rotation: a volume still mounted with a prior key loses access to Ceph.',
    consequences: ['Rook deletes the previous generations of the CSI keys (keepPriorKeyCountMax 0).'],
    typeToConfirm: name(cluster),
    action: 'Remove prior keys',
    target: `cephcluster ${name(cluster)}`,
    onDone: done(onDone),
  });
}

export async function rotateMirrorPeer(stale: Obj, onDone?: () => void): Promise<boolean> {
  const cluster = await fresh(stale);
  const { after, generation } = rotateMirrorPeerKey(cluster);
  return previewChange({
    title: 'Rotate the RBD mirror peer key to aes256k',
    op: 'update',
    before: cluster,
    after,
    danger: true,
    warning: 'Every peer cluster must run Ceph 19.2.6 / 20.2.4 or later: an older peer can no longer pull images with an aes256k key.',
    consequences: [
      `Rook creates generation ${generation} of client.rbd-mirror-peer as aes256k.`,
      'The bootstrap peer token changes: pools show it in status.cephx.peerToken; update the peers that import it.',
    ],
    typeToConfirm: name(cluster),
    action: 'Rotate mirror peer key',
    target: `cephcluster ${name(cluster)}`,
    onDone: done(onDone),
  });
}

export async function onlyAes256k(stale: Obj, onDone?: () => void): Promise<boolean> {
  const cluster = await fresh(stale);
  return previewChange({
    title: 'Allow only aes256k',
    op: 'update',
    before: cluster,
    after: disallowAes(cluster),
    danger: true,
    warning:
      'From now on the monitors refuse every aes key. A client, daemon or peer still on aes can no longer authenticate, and a daemon key still on aes blocks Rook (errno 13).',
    consequences: [
      'Rook sets the monitors auth_allowed_ciphers to aes256k; AUTH_INSECURE_KEYS_ALLOWED clears.',
      'Keys Ceph knows were checked: every one is aes256k. Clients outside the cluster with copies of old keyrings must have new ones.',
      'Emergency way back: allowedCiphers [aes, aes256k] with daemon.keyType aes, then remove daemon.keyType once things work.',
    ],
    typeToConfirm: name(cluster),
    action: 'Allow only aes256k',
    target: `cephcluster ${name(cluster)}`,
    onDone: done(onDone),
  });
}

export async function muteViaRook(stale: Obj, codes: string[], policy: 'mute' | 'unmute', onDone?: () => void): Promise<boolean> {
  const cluster = await fresh(stale);
  return previewChange({
    title: policy === 'mute' ? 'Mute the insecure-key warnings through Rook' : 'Unmute the insecure-key warnings',
    op: 'update',
    before: cluster,
    after: muteThroughRook(cluster, codes, policy),
    consequences:
      policy === 'mute'
        ? [
            `Rook keeps ${codes.join(' and ')} muted in Ceph (spec.healthCheck.muteHealthWarning). The cluster health turns OK if nothing else is wrong.`,
            'The risk stays: aes is still allowed. Set the policy to unmute after the migration; removing the entry alone does not unmute.',
          ]
        : [`Rook unmutes ${codes.join(' and ')}.`],
    action: policy === 'mute' ? 'Mute through Rook' : 'Unmute',
    target: `cephcluster ${name(cluster)}`,
    onDone: done(onDone),
  });
}

export async function rotateClient(stale: Obj, onDone?: () => void): Promise<boolean> {
  const client = await fresh(stale);
  const { after, generation } = rotateClientKey(client);
  return previewChange({
    title: `Move CephClient ${name(client)} to aes256k`,
    op: 'update',
    before: client,
    after,
    danger: true,
    warning: 'Only for clients with Ceph libraries 19.2.6 / 20.2.4 or later, or a host kernel 7.0 or later: older ones cannot use an aes256k key.',
    consequences: [
      `Rook creates generation ${generation} of client.${cephClientUser(client)} as aes256k and updates its Secret.`,
      'Whoever uses the old keyring must take the new one from the Secret.',
    ],
    typeToConfirm: name(client),
    action: 'Rotate key',
    target: `cephclient ${name(client)}`,
    onDone: done(onDone),
  });
}

export function createClient(cr: Obj, onDone?: () => void): Promise<boolean> {
  const caps = Object.entries(cr.spec?.caps ?? {}).map(([k, v]) => `${k} "${v}"`);
  return previewChange({
    title: `Create CephClient ${name(cr)}`,
    op: 'create',
    after: cr,
    action: 'Create CephClient',
    target: `cephclient ${name(cr)}`,
    consequences: [
      `Rook creates the Ceph user client.${cephClientUser(cr)} with ${caps.join(', ') || 'no caps'}.`,
      `It writes the keyring to the Secret rook-ceph-client-${name(cr)} in ${cr.metadata.namespace}.`,
    ],
    onDone: done(onDone),
  });
}

export function deleteClient(cr: Obj, onDone?: () => void): Promise<boolean> {
  return previewChange({
    title: `Delete CephClient ${name(cr)}`,
    op: 'delete',
    before: cr,
    danger: true,
    consequences: [
      `Rook deletes the Ceph user client.${cephClientUser(cr)}: anything using its key loses access to Ceph at once.`,
      cr.spec?.removeSecret === false ? 'The Secret stays (removeSecret false).' : 'Its Secret goes away.',
    ],
    typeToConfirm: name(cr),
    action: 'Delete CephClient',
    target: `cephclient ${name(cr)}`,
    onDone: done(onDone),
  });
}
