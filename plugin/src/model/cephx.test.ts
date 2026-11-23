import {
  capProblem,
  CAPS_PRESETS,
  cephClientCR,
  cephCsiReady,
  cephHasAes256k,
  cephxLadder,
  clientKeyType,
  csiKeyParts,
  csiReadiness,
  decodeCap,
  disallowAes,
  dropPriorCsiKeys,
  entityKind,
  kernelReady,
  keySummary,
  mergeEntities,
  muteThroughRook,
  nameProblem,
  nextStep,
  parseAuthList,
  parseDumpKeys,
  rookMutePolicy,
  rotateClientKey,
  rotateCsiKeys,
  rotateDaemonKeys,
  rotateMirrorPeerKey,
} from './cephx';
import { Obj, Quorum } from './types';

/* Real answers from a test cluster (Ceph 20.2.4, Rook 1.21.2), trimmed; the bridge blanked the keys. */
const AUTH_LS = {
  auth_dump: [
    { entity: 'osd.0', key: '', key_type: 'aes256k', caps: { mgr: 'allow profile osd', mon: 'allow profile osd', osd: 'allow *' } },
    { entity: 'osd.1', key: '', key_type: 'aes256k', caps: { mgr: 'allow profile osd', mon: 'allow profile osd', osd: 'allow *' } },
    { entity: 'client.admin', key: '', key_type: 'aes256k', caps: { mds: 'allow *', mgr: 'allow *', mon: 'allow *', osd: 'allow *' } },
    { entity: 'client.ceph-exporter', key: '', key_type: 'aes256k', caps: { mon: 'allow profile ceph-exporter' } },
    { entity: 'client.crash', key: '', key_type: 'aes256k', caps: { mgr: 'allow rw', mon: 'allow profile crash' } },
    { entity: 'client.csi-cephfs-node.1', key: '', key_type: 'aes256k', caps: { mds: 'allow rw', mon: 'allow r' } },
    { entity: 'client.csi-rbd-node.1', key: '', key_type: 'aes256k', caps: { mgr: 'allow rw', mon: 'profile rbd', osd: 'profile rbd' } },
    { entity: 'client.csi-rbd-provisioner.1', key: '', key_type: 'aes256k', caps: { mon: "profile rbd, allow command 'osd blocklist'" } },
    { entity: 'client.rbd-mirror-peer', key: '', key_type: 'aes256k', caps: { mon: 'profile rbd-mirror-peer', osd: 'profile rbd' } },
    { entity: 'mgr.a', key: '', key_type: 'aes256k', caps: { mds: 'allow *', mon: 'allow profile mgr', osd: 'allow *' } },
  ],
};

const DUMP_KEYS = {
  data: {
    version: 33,
    rotating_version: 3,
    secrets: [
      {
        entity: { type: 4, type_str: 'osd', id: '0' },
        auth: {
          key: { type: 2, type_str: 'aes256k', created: '2026-11-22T23:42:53.721316+0000' },
          pending_key: { type: 0, type_str: 'none', created: '0.000000' },
          caps: [{ service_name: 'mon', access_spec: '\u0011\u0000\u0000\u0000allow profile osd' }],
        },
      },
      {
        entity: { type: 8, type_str: 'client', id: 'admin' },
        auth: { key: { type: 2, type_str: 'aes256k', created: '2026-11-22T23:42:05.511071+0000' }, pending_key: { type: 0, type_str: 'none' }, caps: [] },
      },
      {
        entity: { type: 8, type_str: 'client', id: 'legacy-backup' },
        auth: {
          key: { type: 1, type_str: 'aes', created: '2026-01-02T03:04:05.000000+0000' },
          pending_key: { type: 0, type_str: 'none' },
          caps: [{ service_name: 'mon', access_spec: '\u0007\u0000\u0000\u0000allow r' }],
        },
      },
    ],
    rotating_secrets: [
      {
        entity: { type: 1, type_str: 'mon', id: '*' },
        secrets: { max_ver: 5, keys: [{ id: 3, expiring_key: { key: { type: 2, type_str: 'aes256k' } } }] },
      },
      {
        entity: { type: 4, type_str: 'osd', id: '*' },
        secrets: { max_ver: 5, keys: [{ id: 3, expiring_key: { key: { type: 2, type_str: 'aes256k' } } }] },
      },
    ],
  },
};

const QUORUM: Quorum = {
  leader: 'a',
  quorum: ['a', 'b', 'c'],
  ageSec: 100,
  mons: [],
  allowedCiphers: ['aes', 'aes256k'],
  preferredCipher: 'aes256k',
  serviceCipher: 'aes256k',
  minMonRelease: 'tentacle',
};

const CLUSTER: Obj = {
  apiVersion: 'ceph.rook.io/v1',
  kind: 'CephCluster',
  metadata: { name: 'rook-ceph', namespace: 'rook-ceph', resourceVersion: '1' },
  spec: { cephVersion: { image: 'quay.io/ceph/ceph:v20.2.4' } },
  status: {
    cephx: {
      admin: {},
      cephExporter: { keyCephVersion: '20.2.4-0', keyGeneration: 1 },
      crashCollector: { keyCephVersion: '20.2.4-0', keyGeneration: 1 },
      csi: { keyCephVersion: '20.2.4-0', keyGeneration: 1 },
      mgr: { keyCephVersion: '20.2.4-0', keyGeneration: 1, keyType: 'aes256k' },
      mon: { keyCephVersion: '20.2.4-0', keyGeneration: 1 },
      osd: { keyCephVersion: '20.2.4-0', keyGeneration: 1, keyType: 'aes256k' },
      rbdMirrorPeer: { keyCephVersion: '20.2.4-0', keyGeneration: 1 },
    },
  },
};

const CHECKS = ['AUTH_INSECURE_KEYS_ALLOWED', 'AUTH_INSECURE_KEYS_CREATABLE'];

describe('entities', () => {
  it('decodes the length-prefixed caps of dump-keys', () => {
    expect(decodeCap('\u0011\u0000\u0000\u0000allow profile osd')).toBe('allow profile osd');
    expect(decodeCap('allow r')).toBe('allow r');
    // A 65-character cap: its length byte is "A".
    const long = 'x'.repeat(65);
    expect(decodeCap(`A\u0000\u0000\u0000${long}`)).toBe(long);
  });

  it('sorts entities into ladder categories', () => {
    const clients = new Set(['backup']);
    expect(entityKind('osd.3')).toBe('daemon');
    expect(entityKind('mgr.a')).toBe('daemon');
    expect(entityKind('mds.test-fs-a')).toBe('daemon');
    expect(entityKind('client.admin')).toBe('daemon');
    expect(entityKind('client.rgw.test.store.a')).toBe('daemon');
    expect(entityKind('client.csi-rbd-node.1')).toBe('csi');
    expect(entityKind('client.rbd-mirror-peer')).toBe('mirror');
    expect(entityKind('client.backup', clients)).toBe('cephclient');
    expect(entityKind('client.someone')).toBe('other');
  });

  it('parses auth ls and corrects key types with dump-keys', () => {
    const list = parseAuthList(AUTH_LS);
    expect(list).toHaveLength(10);
    expect(list[0]).toMatchObject({ entity: 'osd.0', type: 'osd', id: '0', keyType: 'aes256k', kind: 'daemon' });
    expect(list[0].caps.osd).toBe('allow *');
    const dump = parseDumpKeys(DUMP_KEYS);
    expect(dump.keys.get('osd.0')).toMatchObject({ keyType: 'aes256k', pending: 'none' });
    expect(dump.keys.get('client.legacy-backup')?.caps.mon).toBe('allow r');
    expect(dump.rotating).toEqual([
      { service: 'mon', keyTypes: ['aes256k'] },
      { service: 'osd', keyTypes: ['aes256k'] },
    ]);
    const merged = mergeEntities(list, dump);
    expect(merged).toHaveLength(11);
    const legacy = merged.find(e => e.entity === 'client.legacy-backup');
    expect(legacy).toMatchObject({ keyType: 'aes', kind: 'other' });
    expect(merged.find(e => e.entity === 'osd.0')?.created).toBe(Date.parse('2026-11-22T23:42:53.721+00:00'));
  });

  it('never keeps a key value', () => {
    const merged = mergeEntities(parseAuthList(AUTH_LS), parseDumpKeys(DUMP_KEYS));
    expect(JSON.stringify(merged)).not.toMatch(/"key":/);
  });

  it('counts key types by category', () => {
    const s = keySummary(mergeEntities(parseAuthList(AUTH_LS), parseDumpKeys(DUMP_KEYS)));
    expect(s).toMatchObject({ total: 11, aes256k: 10, aes: 1 });
    expect(s.byKind.csi).toEqual({ total: 3, aes256k: 3, aes: 0 });
    expect(s.byKind.other).toEqual({ total: 1, aes256k: 0, aes: 1 });
  });

  it('splits CSI key generations', () => {
    expect(csiKeyParts('csi-rbd-node.2')).toEqual({ base: 'csi-rbd-node', gen: 2 });
    expect(csiKeyParts('csi-rbd-node')).toEqual({ base: 'csi-rbd-node', gen: 0 });
  });
});

describe('ladder', () => {
  it('reads the sample: every key is aes256k, aes is still allowed', () => {
    const steps = cephxLadder({ entities: parseAuthList(AUTH_LS), quorum: QUORUM, cluster: CLUSTER, clients: [], checks: CHECKS });
    expect(steps.map(s => [s.id, s.state])).toEqual([
      ['daemon', 'done'],
      ['csi', 'done'],
      ['clients', 'none'],
      ['mirror', 'done'],
      ['ciphers', 'todo'],
    ]);
    expect(steps[4].blockedBy).toBeUndefined();
    expect(nextStep(steps)?.id).toBe('ciphers');
    expect(steps[0].evidence.join(' ')).toContain('6 of 6 daemon keys');
  });

  it('blocks step 5 while a key is aes', () => {
    const es = mergeEntities(parseAuthList(AUTH_LS), parseDumpKeys(DUMP_KEYS));
    const steps = cephxLadder({ entities: es, quorum: QUORUM, cluster: CLUSTER, clients: [], checks: CHECKS });
    expect(steps[4].blockedBy).toContain('client.legacy-backup');
    expect(steps[4].insecure).toEqual(['client.legacy-backup']);
  });

  it('marks daemon keys partly done while service tickets are aes', () => {
    const es = parseAuthList(AUTH_LS).map(e => (e.entity === 'osd.1' ? { ...e, keyType: 'aes' as const } : e));
    const steps = cephxLadder({ entities: es, quorum: { ...QUORUM, serviceCipher: 'aes' }, cluster: CLUSTER, clients: [], checks: [] });
    expect(steps[0].state).toBe('partial');
    expect(steps[0].insecure).toEqual(['osd.1']);
    const allNew = cephxLadder({ entities: parseAuthList(AUTH_LS), quorum: { ...QUORUM, serviceCipher: 'aes' }, cluster: CLUSTER, clients: [], checks: [] });
    expect(allNew[0].state).toBe('partial');
  });

  it('marks CSI partly done while prior aes keys are kept', () => {
    const es = [
      ...parseAuthList(AUTH_LS).filter(e => e.kind !== 'csi'),
      { entity: 'client.csi-rbd-node.1', type: 'client', id: 'csi-rbd-node.1', keyType: 'aes' as const, caps: {}, kind: 'csi' as const },
      { entity: 'client.csi-rbd-node.2', type: 'client', id: 'csi-rbd-node.2', keyType: 'aes256k' as const, caps: {}, kind: 'csi' as const },
    ];
    const steps = cephxLadder({ entities: es, quorum: QUORUM, cluster: CLUSTER, clients: [], checks: [] });
    expect(steps[1].state).toBe('partial');
    expect(steps[1].evidence.join(' ')).toContain('1 prior key kept');
  });

  it('follows CephClients and shows a pending rotation', () => {
    const client: Obj = {
      kind: 'CephClient',
      metadata: { name: 'backup', namespace: 'rook-ceph' },
      spec: { caps: { mon: 'allow r' }, security: { cephx: { keyGeneration: 2, keyRotationPolicy: 'KeyGeneration' } } },
      status: { cephx: { keyGeneration: 1, keyType: 'aes' } },
    };
    const es = [...parseAuthList(AUTH_LS, new Set(['backup'])), { entity: 'client.backup', type: 'client', id: 'backup', keyType: 'aes' as const, caps: {}, kind: 'cephclient' as const }];
    const steps = cephxLadder({ entities: es, quorum: QUORUM, cluster: CLUSTER, clients: [client], checks: [] });
    expect(steps[2].state).toBe('todo');
    expect(steps[2].pending).toContain('backup');
    expect(clientKeyType(client, es)).toBe('aes');
    expect(clientKeyType(client, null)).toBe('aes');
  });

  it('is unknown without live data and done when aes is gone', () => {
    const u = cephxLadder({ entities: null, quorum: null, cluster: CLUSTER, clients: [], checks: [] });
    expect(u.every(s => s.state === 'unknown')).toBe(true);
    const done = cephxLadder({
      entities: parseAuthList(AUTH_LS),
      quorum: { ...QUORUM, allowedCiphers: ['aes256k'] },
      cluster: CLUSTER,
      clients: [],
      checks: [],
    });
    expect(done[4].state).toBe('done');
    expect(nextStep(done)).toBeNull();
  });

  it('sees a daemon rotation in progress', () => {
    const c = rotateDaemonKeys(CLUSTER).after;
    const steps = cephxLadder({ entities: parseAuthList(AUTH_LS), quorum: QUORUM, cluster: c, clients: [], checks: [] });
    expect(steps[0].pending).toContain('generation 2');
  });
});

describe('builders', () => {
  it('bumps the daemon key generation and leaves the original alone', () => {
    const { after, generation } = rotateDaemonKeys(CLUSTER);
    expect(generation).toBe(2);
    expect(after.spec.security.cephx.daemon).toEqual({ keyRotationPolicy: 'KeyGeneration', keyGeneration: 2 });
    expect(CLUSTER.spec.security).toBeUndefined();
    expect(after.metadata.resourceVersion).toBe('1');
  });

  it('drops an emergency daemon keyType aes', () => {
    const c = { ...CLUSTER, spec: { ...CLUSTER.spec, security: { cephx: { daemon: { keyType: 'aes', keyGeneration: 3 } } } } };
    const { after, generation } = rotateDaemonKeys(c);
    expect(generation).toBe(4);
    expect(after.spec.security.cephx.daemon.keyType).toBeUndefined();
  });

  it('rotates CSI keys with an explicit key type and a prior key', () => {
    const { after } = rotateCsiKeys(CLUSTER);
    expect(after.spec.security.cephx.csi).toEqual({ keyRotationPolicy: 'KeyGeneration', keyGeneration: 2, keepPriorKeyCountMax: 1, keyType: 'aes256k' });
    expect(dropPriorCsiKeys(after).spec.security.cephx.csi.keepPriorKeyCountMax).toBe(0);
  });

  it('rotates the mirror peer and a CephClient', () => {
    expect(rotateMirrorPeerKey(CLUSTER).after.spec.security.cephx.rbdMirrorPeer).toMatchObject({ keyGeneration: 2, keyType: 'aes256k' });
    const cl: Obj = { kind: 'CephClient', metadata: { name: 'x' }, spec: { caps: {} }, status: { cephx: { keyGeneration: 1 } } };
    expect(rotateClientKey(cl).after.spec.security.cephx).toEqual({ keyRotationPolicy: 'KeyGeneration', keyGeneration: 2, keyType: 'aes256k' });
  });

  it('allows only aes256k', () => {
    expect(disallowAes(CLUSTER).spec.security.cephx.allowedCiphers).toEqual(['aes256k']);
  });

  it('mutes through Rook', () => {
    const m = muteThroughRook(CLUSTER, ['AUTH_INSECURE_KEYS_ALLOWED', 'AUTH_INSECURE_KEYS_CREATABLE']);
    expect(m.spec.healthCheck.muteHealthWarning).toEqual({
      AUTH_INSECURE_KEYS_ALLOWED: { policy: 'mute' },
      AUTH_INSECURE_KEYS_CREATABLE: { policy: 'mute' },
    });
    expect(rookMutePolicy(m, 'AUTH_INSECURE_KEYS_ALLOWED')).toBe('mute');
    expect(rookMutePolicy(CLUSTER, 'AUTH_INSECURE_KEYS_ALLOWED')).toBeNull();
    expect(rookMutePolicy(muteThroughRook(m, ['AUTH_INSECURE_KEYS_ALLOWED'], 'unmute'), 'AUTH_INSECURE_KEYS_ALLOWED')).toBe('unmute');
  });

  it('builds a CephClient from a preset', () => {
    const rbd = CAPS_PRESETS.find(p => p.id === 'rbd')!;
    const cr = cephClientCR({ name: 'test-client', namespace: 'rook-ceph', caps: { ...rbd.caps('test-pool'), mds: '  ' } });
    expect(cr).toEqual({
      apiVersion: 'ceph.rook.io/v1',
      kind: 'CephClient',
      metadata: { name: 'test-client', namespace: 'rook-ceph' },
      spec: { caps: { mon: 'profile rbd', osd: 'profile rbd pool=test-pool', mgr: 'profile rbd pool=test-pool' } },
    });
    expect(cephClientCR({ name: 'a', namespace: 'n', caps: { mon: 'allow r' }, keyType: 'aes256k' }).spec.security).toEqual({ cephx: { keyType: 'aes256k' } });
  });

  it('checks names and caps', () => {
    expect(nameProblem('test-client')).toBeNull();
    expect(nameProblem('Test')).toMatch(/Lowercase/);
    expect(nameProblem('')).toMatch(/name/);
    expect(nameProblem('a'.repeat(64))).toMatch(/63/);
    expect(capProblem('allow r')).toBeNull();
    expect(capProblem('profile rbd')).toBeNull();
    expect(capProblem('rw')).toMatch(/allow/);
  });
});

describe('CSI readiness', () => {
  const node = (name: string, kernel: string): Obj => ({ metadata: { name }, status: { nodeInfo: { kernelVersion: kernel } } });
  const pod = (image: string): Obj => ({ metadata: { name: 'p' }, spec: { containers: [{ image }, { image: 'registry.k8s.io/sig-storage/csi-provisioner:v6.3.0' }] } });

  it('reads kernels and Ceph-CSI images', () => {
    expect(kernelReady('7.3.4-300.fc45.x86_64')).toBe(true);
    expect(kernelReady('6.12.9-200.fc41.x86_64')).toBe(false);
    expect(kernelReady('7.1.0', true)).toBe(false);
    expect(kernelReady('weird')).toBeNull();
    expect(cephCsiReady('quay.io/cephcsi/cephcsi:v3.18.1')).toBe(true);
    expect(cephCsiReady('quay.io/cephcsi/cephcsi:v3.17.0')).toBe(false);
    expect(cephCsiReady('quay.io/cephcsi/cephcsi:v3.17.1')).toBe(true);
    expect(cephCsiReady('quay.io/cephcsi/cephcsi@sha256:abc')).toBeNull();
  });

  it('says what blocks the CSI step', () => {
    const current = csiReadiness([node('a', '7.3.4-300.fc45.x86_64'), node('b', '7.3.4-300.fc45.x86_64')], [pod('quay.io/cephcsi/cephcsi:v3.18.1')]);
    expect(current.ready).toBe(true);
    expect(current.images).toEqual([{ image: 'quay.io/cephcsi/cephcsi:v3.18.1', ready: true }]);
    const old = csiReadiness([node('a', '6.8.0')], [pod('quay.io/cephcsi/cephcsi:v3.16.0')]);
    expect(old.ready).toBe(false);
    expect(old.problems).toHaveLength(2);
  });
});

describe('Ceph versions', () => {
  it('knows which releases have aes256k', () => {
    expect(cephHasAes256k('20.2.4-0')).toBe(true);
    expect(cephHasAes256k('ceph version 20.2.3 (abc) tentacle')).toBe(false);
    expect(cephHasAes256k('19.2.6')).toBe(true);
    expect(cephHasAes256k('19.2.5')).toBe(false);
    expect(cephHasAes256k('18.2.7')).toBe(false);
    expect(cephHasAes256k('21.0.0')).toBe(true);
    expect(cephHasAes256k('')).toBeNull();
  });
});
