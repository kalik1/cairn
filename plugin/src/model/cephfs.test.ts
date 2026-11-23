import {
  cephfsCsi,
  cephfsVolumes,
  DEFAULT_FS_FORM,
  DEFAULT_SVG_FORM,
  filesystemCR,
  fsDeleteBlockers,
  fsFormProblems,
  fsState,
  groupFromPath,
  mdsPodCount,
  mdsTone,
  parseFsDump,
  parseFsStatus,
  parseGroupInfo,
  parseNameList,
  parseSubvolumeInfo,
  phaseTone,
  pinningWord,
  quantityBytes,
  rookFsPools,
  standbysFor,
  subvolumeGroupCR,
  svgDeleteBlockers,
  svgFormProblems,
  withStatus,
} from './cephfs';
import { Obj } from './types';

/* Real answers from a test cluster right after Cairn created test-fs (Ceph 20.2.4, Rook 1.21.2), compat maps trimmed. */
const FS_DUMP = {
  epoch: 6,
  btime: '2026-11-23T03:23:51:091252+0000',
  default_fscid: 1,
  compat: {},
  feature_flags: { enable_multiple: true, ever_enabled_multiple: true },
  standbys: [],
  filesystems: [
    {
      mdsmap: {
        epoch: 6,
        flags: 18,
        flags_state: {
          joinable: true,
          allow_snaps: true,
          allow_multimds_snaps: true,
          allow_standby_replay: false,
          refuse_client_session: false,
          refuse_standby_for_another_fs: false,
          balance_automate: false,
        },
        created: '2026-11-23T03:23:48.353102+0000',
        modified: '2026-11-23T03:23:50.564057+0000',
        session_timeout: 60,
        max_file_size: 1099511627776,
        compat: {},
        max_mds: 1,
        in: [0],
        up: { mds_0: 24356 },
        failed: [],
        damaged: [],
        stopped: [],
        info: {
          gid_24356: {
            gid: 24356,
            name: 'test-fs-a',
            rank: 0,
            incarnation: 4,
            state: 'up:active',
            state_seq: 3,
            addr: '198.51.100.103:6801/1009',
            join_fscid: 1,
            export_targets: [],
            features: 4541880224203014143,
            flags: 0,
            compat: {},
          },
        },
        data_pools: [7],
        metadata_pool: 6,
        enabled: true,
        fs_name: 'test-fs',
        balancer: '',
        bal_rank_mask: '-1',
        standby_count_wanted: 0,
        qdb_leader: 24356,
        qdb_cluster: [24356],
      },
      id: 1,
    },
  ],
};

const FS_STATUS = {
  clients: [{ clients: 1, fs: 'test-fs' }],
  mds_version: [{ daemon: ['test-fs-a'], version: 'ceph version 20.2.4 (7f793731f1b39eb4f465e960113d2363c311b964) tentacle (stable - RelWithDebInfo)' }],
  mdsmap: [{ caps: 3, dirs: 14, dns: 12, inos: 15, name: 'test-fs-a', rank: 0, rate: 0, state: 'active' }],
  pools: [
    { avail: 71648559104, id: 6, name: 'test-fs-metadata', type: 'metadata', used: 105817 },
    { avail: 71648559104, id: 7, name: 'test-fs-data0', type: 'data', used: 0 },
  ],
};

const GROUP_INFO = {
  atime: '2026-11-23 03:23:52',
  bytes_pcent: 'undefined',
  bytes_quota: 'infinite',
  bytes_used: 0,
  casesensitive: true,
  created_at: '2026-11-23 03:23:52',
  ctime: '2026-11-23 03:23:52',
  data_pool: 'test-fs-data0',
  gid: 0,
  mode: 16877,
  mon_addrs: ['203.0.113.11:6789'],
  mtime: '2026-11-23 03:23:52',
  normalization: 'none',
  uid: 0,
};

/* The shape of "fs subvolume info" (Ceph docs; quota set, used bytes). */
const SUB_INFO = {
  atime: '2026-11-23 03:40:00',
  bytes_pcent: '0.01',
  bytes_quota: 1073741824,
  bytes_used: 12288,
  created_at: '2026-11-23 03:40:00',
  data_pool: 'test-fs-data0',
  features: ['snapshot-clone', 'snapshot-autoprotect', 'snapshot-retention'],
  mode: 16877,
  path: '/volumes/csi/csi-vol-1b2c/3d4e',
  pool_namespace: '',
  state: 'complete',
  type: 'subvolume',
  uid: 0,
};

const pv = (name: string, attrs: Record<string, string>, claim?: string): Obj => ({
  metadata: { name },
  spec: {
    csi: { driver: 'rook-ceph.cephfs.csi.ceph.com', volumeHandle: 'x', volumeAttributes: attrs },
    capacity: { storage: '1Gi' },
    ...(claim ? { claimRef: { namespace: 'apps', name: claim } } : {}),
  },
  status: { phase: 'Bound' },
});

describe('fs dump and fs status', () => {
  it('parses the sample file system', () => {
    const m = parseFsDump(FS_DUMP);
    expect(m.epoch).toBe(6);
    expect(m.standbys).toEqual([]);
    const fs = m.filesystems[0];
    expect(fs).toMatchObject({
      id: 1,
      name: 'test-fs',
      maxMds: 1,
      metadataPool: 6,
      dataPools: [7],
      allowStandbyReplay: false,
      joinable: true,
      enabled: true,
      standbyWanted: 0,
    });
    expect(fs.ranks).toEqual([{ rank: 0, state: 'active', mds: 'test-fs-a' }]);
    expect(fs.created).toBe(Date.parse('2026-11-23T03:23:48.353Z'));
    expect(fsState(fs)).toMatchObject({ tone: 'ok', word: 'Active' });
  });

  it('merges fs status: clients and rank activity', () => {
    const st = parseFsStatus(FS_STATUS, 'test-fs');
    expect(st.clients).toBe(1);
    expect(st.pools.map(p => [p.name, p.type])).toEqual([
      ['test-fs-metadata', 'metadata'],
      ['test-fs-data0', 'data'],
    ]);
    const fs = withStatus(parseFsDump(FS_DUMP).filesystems[0], st);
    expect(fs.clients).toBe(1);
    expect(fs.ranks[0]).toMatchObject({ dns: 12, inos: 15, caps: 3, rate: 0 });
    expect(fs.versions?.[0]).toContain('20.2.4');
  });

  it('sees failed ranks, replay and standbys', () => {
    const dump = JSON.parse(JSON.stringify(FS_DUMP));
    const m0 = dump.filesystems[0].mdsmap;
    m0.max_mds = 2;
    m0.in = [0, 1];
    m0.failed = [1];
    m0.info.gid_1 = { gid: 1, name: 'test-fs-b', rank: 0, state: 'up:standby-replay', join_fscid: 1 };
    dump.standbys = [
      { gid: 9, name: 'test-fs-c', rank: -1, state: 'up:standby', join_fscid: 1 },
      { gid: 8, name: 'other-a', rank: -1, state: 'up:standby', join_fscid: 2 },
    ];
    const m = parseFsDump(dump);
    const fs = m.filesystems[0];
    expect(fs.ranks).toEqual([
      { rank: 0, state: 'active', mds: 'test-fs-a' },
      { rank: 1, state: 'failed' },
    ]);
    expect(fs.replay.map(d => d.name)).toEqual(['test-fs-b']);
    expect(standbysFor(fs, m).map(d => d.name)).toEqual(['test-fs-c']);
    expect(fsState(fs)).toMatchObject({ tone: 'err', word: 'Offline' });
    m0.failed = [];
    m0.info.gid_2 = { gid: 2, name: 'test-fs-d', rank: 1, state: 'up:rejoin', join_fscid: 1 };
    expect(fsState(parseFsDump(dump).filesystems[0])).toMatchObject({ tone: 'move', word: 'Recovering' });
    m0.damaged = [1];
    expect(fsState(parseFsDump(dump).filesystems[0]).word).toBe('Damaged');
  });

  it('gives MDS states a tone', () => {
    expect(mdsTone('active')).toBe('ok');
    expect(mdsTone('standby-replay')).toBe('idle');
    expect(mdsTone('replay')).toBe('move');
    expect(mdsTone('damaged')).toBe('err');
  });

  it('survives garbage', () => {
    expect(parseFsDump(null)).toEqual({ epoch: 0, filesystems: [], standbys: [] });
    expect(parseFsStatus(undefined).clients).toBe(0);
  });
});

describe('subvolumes', () => {
  it('parses names, group and subvolume info', () => {
    expect(parseNameList([{ name: 'csi' }])).toEqual(['csi']);
    expect(parseNameList([])).toEqual([]);
    const g = parseGroupInfo(GROUP_INFO, 'csi');
    expect(g).toMatchObject({ name: 'csi', usedBytes: 0, quotaBytes: null, dataPool: 'test-fs-data0', mode: '40755' });
    expect(g.created).toBe(Date.parse('2026-11-23T03:23:52Z'));
    const s = parseSubvolumeInfo(SUB_INFO, 'csi-vol-1b2c', 'csi');
    expect(s).toMatchObject({ usedBytes: 12288, quotaBytes: 1073741824, state: 'complete', path: '/volumes/csi/csi-vol-1b2c/3d4e' });
    expect(parseSubvolumeInfo({ bytes_quota: 'infinite', bytes_used: 5 }, 'x', 'g').quotaBytes).toBeNull();
  });

  it('maps CSI volumes to file systems and groups', () => {
    expect(groupFromPath('/volumes/csi/csi-vol-1b2c/3d4e')).toBe('csi');
    expect(groupFromPath('/other')).toBe('');
    const pvs = [
      pv('pvc-1', { fsName: 'test-fs', subvolumeName: 'csi-vol-1b2c', subvolumePath: '/volumes/csi/csi-vol-1b2c/3d4e', clusterID: 'abc' }, 'data'),
      pv('pvc-2', { fsName: 'other', subvolumeName: 'csi-vol-9', subvolumePath: '/volumes/team/csi-vol-9/1' }),
      { metadata: { name: 'rbd' }, spec: { csi: { driver: 'rook-ceph.rbd.csi.ceph.com', volumeAttributes: { pool: 'vm-pool' } } } },
    ];
    const vols = cephfsVolumes(pvs, 'test-fs');
    expect(vols).toHaveLength(1);
    expect(vols[0]).toMatchObject({ fsName: 'test-fs', subvolume: 'csi-vol-1b2c', group: 'csi', claim: 'apps/data', clusterID: 'abc', static: false });
    expect(cephfsVolumes(pvs)).toHaveLength(2);
  });

  it('knows whether the CephFS CSI driver exists', () => {
    const rbd: Obj = { metadata: { name: 'rook-ceph.rbd.csi.ceph.com' } };
    expect(cephfsCsi([rbd], [])).toEqual({ present: false, driver: undefined, storageClasses: [], others: ['rook-ceph.rbd.csi.ceph.com'] });
    const fsd: Obj = { metadata: { name: 'rook-ceph.cephfs.csi.ceph.com' } };
    const sc: Obj = { metadata: { name: 'cephfs' }, provisioner: 'rook-ceph.cephfs.csi.ceph.com', parameters: { fsName: 'test-fs' } };
    expect(cephfsCsi([rbd, fsd], [sc])).toMatchObject({ present: true, driver: 'rook-ceph.cephfs.csi.ceph.com', storageClasses: ['cephfs'] });
  });
});

describe('resources', () => {
  it('builds the sample test-fs', () => {
    const cr = filesystemCR({
      ...DEFAULT_FS_FORM,
      name: 'test-fs',
      activeStandby: false,
      cpuRequest: '100m',
      memRequest: '256Mi',
      memLimit: '1Gi',
      preserve: false,
    });
    expect(cr).toEqual({
      apiVersion: 'ceph.rook.io/v1',
      kind: 'CephFilesystem',
      metadata: { name: 'test-fs', namespace: 'rook-ceph' },
      spec: {
        metadataPool: { failureDomain: 'host', replicated: { size: 3 } },
        dataPools: [{ name: 'data0', failureDomain: 'host', replicated: { size: 3 } }],
        preserveFilesystemOnDelete: false,
        metadataServer: {
          activeCount: 1,
          activeStandby: false,
          resources: { requests: { cpu: '100m', memory: '256Mi' }, limits: { memory: '1Gi' } },
        },
      },
    });
    expect(rookFsPools(cr)).toEqual({ metadata: 'test-fs-metadata', data: ['test-fs-data0'] });
    expect(mdsPodCount(cr)).toBe(1);
    expect(mdsPodCount({ ...cr, spec: { ...cr.spec, metadataServer: { activeCount: 2, activeStandby: true } } })).toBe(4);
  });

  it('names pools like Rook', () => {
    const cr: Obj = { metadata: { name: 'fs' }, spec: { dataPools: [{ name: 'a' }, {}], metadataPool: { name: 'md' } } };
    expect(rookFsPools(cr)).toEqual({ metadata: 'fs-metadata', data: ['fs-a', 'fs-data1'] });
    expect(rookFsPools({ ...cr, spec: { ...cr.spec, preservePoolNames: true } })).toEqual({ metadata: 'md', data: ['a', 'fs-data1'] });
  });

  it('checks the form', () => {
    const ok = { ...DEFAULT_FS_FORM, name: 'test-fs' };
    expect(fsFormProblems(ok, new Set())).toEqual({});
    expect(fsFormProblems(ok, new Set(['test-fs'])).name).toMatch(/exists/);
    expect(fsFormProblems({ ...ok, metadataSize: 4 }, new Set(), 3).metadataSize).toMatch(/3 hosts/);
    expect(fsFormProblems({ ...ok, dataPools: [{ name: 'd', size: 3, ec: { k: 2, m: 1 } }] }, new Set()).pool0).toMatch(/replicated/);
    expect(fsFormProblems({ ...ok, dataPools: [{ name: 'd', size: 3 }, { name: 'e', size: 0, ec: { k: 4, m: 2 } }] }, new Set(), 3).pool1).toMatch(/6 hosts/);
    expect(fsFormProblems({ ...ok, memRequest: '2Gi', memLimit: '1Gi' }, new Set()).memLimit).toMatch(/below/);
    expect(fsFormProblems({ ...ok, cpuRequest: 'lots' }, new Set()).cpuRequest).toMatch(/quantity/);
    expect(quantityBytes('256Mi')).toBe(256 * 1024 * 1024);
    expect(quantityBytes('1G')).toBe(1e9);
  });

  it('builds a subvolume group', () => {
    const f = { ...DEFAULT_SVG_FORM, name: 'test-svg', filesystem: 'test-fs' };
    expect(subvolumeGroupCR(f)).toEqual({
      apiVersion: 'ceph.rook.io/v1',
      kind: 'CephFilesystemSubVolumeGroup',
      metadata: { name: 'test-svg', namespace: 'rook-ceph' },
      spec: { filesystemName: 'test-fs', pinning: { distributed: 1 } },
    });
    const g = subvolumeGroupCR({ ...f, groupName: 'team', quota: '10Gi', pinning: 'none', dataPoolName: 'test-fs-data0' });
    expect(g.spec).toEqual({ filesystemName: 'test-fs', name: 'team', quota: '10Gi', dataPoolName: 'test-fs-data0' });
    expect(pinningWord(subvolumeGroupCR(f))).toBe('Distributed');
    expect(pinningWord(g)).toBe('None');
    expect(svgFormProblems(f, new Set(), new Set())).toEqual({});
    expect(svgFormProblems({ ...f, groupName: 'csi' }, new Set(), new Set()).groupName).toMatch(/reserved/);
    expect(svgFormProblems(f, new Set(['test-svg']), new Set()).name).toMatch(/exists/);
  });

  it('refuses deletes while volumes or groups depend on a file system', () => {
    const pvs = [pv('pvc-1', { fsName: 'test-fs', subvolumeName: 'csi-vol-1', subvolumePath: '/volumes/csi/csi-vol-1/u' }, 'data')];
    const svg: Obj = { metadata: { name: 'test-svg' }, spec: { filesystemName: 'test-fs' }, status: { info: { clusterID: 'cid' } } };
    const why = fsDeleteBlockers('test-fs', pvs, [svg]);
    expect(why[0]).toContain('pvc-1 (apps/data)');
    expect(why[1]).toContain('test-svg');
    expect(fsDeleteBlockers('test-fs', [], [])).toEqual([]);
    expect(svgDeleteBlockers(svg, pvs, [])).toEqual([]);
    const inGroup = [pv('pvc-2', { fsName: 'test-fs', subvolumeName: 'csi-vol-2', subvolumePath: '/volumes/test-svg/csi-vol-2/u' })];
    expect(svgDeleteBlockers(svg, inGroup, null)[0]).toContain('pvc-2');
    expect(svgDeleteBlockers(svg, [], ['csi-vol-3'])[0]).toContain('1 subvolume');
  });

  it('gives Rook phases a tone', () => {
    expect(phaseTone('Ready')).toBe('ok');
    expect(phaseTone('Progressing')).toBe('move');
    expect(phaseTone('Failure')).toBe('err');
    expect(phaseTone(undefined)).toBe('idle');
  });
});
