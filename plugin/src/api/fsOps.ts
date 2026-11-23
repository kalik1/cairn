/*
 * CephFS commands and changes. Reads are mgr/mon commands through the
 * bridge (fs dump, fs status, the volumes module's subvolume commands);
 * every change is a Rook resource (CephFilesystem,
 * CephFilesystemSubVolumeGroup) through the change preview, so Rook makes
 * it in Ceph.
 */

import { cephfsVolumes, fsDeleteBlockers, rookFsPools, svgDeleteBlockers, svgGroupName } from '../model/cephfs';
import { Obj } from '../model/types';
import { previewChange } from '../ui/ChangeDialog';
import { CephQuery, mgr, mon } from './bridge';
import { invalidateCephQueries } from './ceph';

/** Query-cache key prefix of every CephFS query. */
export const FS_KEY = 'cephfs';

export const fsDumpQuery: CephQuery[] = [mon('fs dump')];

/** fs status per file system (its JSON does not say which fs a rank belongs to when there are several). */
export const fsStatusQueries = (names: string[]): CephQuery[] => names.map(fs => mgr('fs status', { fs }));

/** Groups of a file system, and the subvolumes made without a group. */
export const fsGroupsQueries = (fs: string): CephQuery[] => [mgr('fs subvolumegroup ls', { vol_name: fs }), mgr('fs subvolume ls', { vol_name: fs })];

/** Info and subvolume list of each group. */
export const fsGroupDetailQueries = (fs: string, groups: string[]): CephQuery[] =>
  groups.flatMap(g => [mgr('fs subvolumegroup info', { vol_name: fs, group_name: g }), mgr('fs subvolume ls', { vol_name: fs, group_name: g })]);

/** Info of each subvolume (group "" = no group). */
export const subvolumeInfoQueries = (fs: string, subs: { group: string; name: string }[]): CephQuery[] =>
  subs.map(s => mgr('fs subvolume info', { vol_name: fs, sub_name: s.name, ...(s.group ? { group_name: s.group } : {}) }));

/** At most this many subvolumes get an info call per refresh. */
export const SUBVOLUME_INFO_LIMIT = 150;

const done = (refresh?: () => void) => () => {
  invalidateCephQueries(FS_KEY);
  refresh?.();
};

export function createFilesystem(cr: Obj, opts: { mdsPods: number; refresh?: () => void; onDone?: () => void }): Promise<boolean> {
  const pools = rookFsPools(cr);
  const ms = cr.spec?.metadataServer ?? {};
  const res = ms.resources ?? {};
  return previewChange({
    title: `Create file system ${cr.metadata.name}`,
    op: 'create',
    after: cr,
    action: 'Create file system',
    target: `filesystem ${cr.metadata.name}`,
    consequences: [
      `Rook creates the pools ${pools.metadata} (metadata) and ${pools.data.join(', ')} (data), then the file system.`,
      `It starts ${opts.mdsPods} MDS pod${opts.mdsPods === 1 ? '' : 's'} (${ms.activeCount ?? 1} active${ms.activeStandby ? `, ${opts.mdsPods - (ms.activeCount ?? 1)} standby-replay` : ', no standby'})${
        res.requests?.memory ? `, each asking for ${res.requests.memory} of memory` : ''
      }${res.limits?.memory ? ` (limit ${res.limits.memory})` : ''}.`,
      cr.spec?.preserveFilesystemOnDelete
        ? 'Deleting the resource later keeps the file system and its data in Ceph.'
        : 'Deleting the resource later deletes the file system and every file in it.',
    ],
    onDone: () => {
      done(opts.refresh)();
      opts.onDone?.();
    },
  });
}

/** Deleting a CephFilesystem: what happens to the data depends on the preserve flags. */
export function deleteFilesystemConsequences(cr: Obj, pvs: Obj[]): string[] {
  const pools = rookFsPools(cr);
  const keepFs = !!cr.spec?.preserveFilesystemOnDelete;
  const keepPools = keepFs || !!cr.spec?.preservePoolsOnDelete;
  const out = [`Rook stops the MDS daemons of ${cr.metadata.name}.`];
  if (keepFs) out.push('preserveFilesystemOnDelete is set: the Ceph file system and its pools stay, with every file. You can create the resource again to serve it.');
  else if (keepPools) out.push(`Rook removes the file system but keeps its pools (${[pools.metadata, ...pools.data].join(', ')}) and their objects.`);
  else out.push(`Rook removes the file system and deletes its pools ${[pools.metadata, ...pools.data].join(', ')}: every file in it is lost.`);
  const vols = cephfsVolumes(pvs, cr.metadata.name);
  if (vols.length) out.push(`${vols.length} Kubernetes volumes would lose their data.`);
  return out;
}

export function deleteFilesystem(cr: Obj, opts: { pvs: Obj[]; refresh?: () => void; onDone?: () => void }): Promise<boolean> {
  const keep = !!cr.spec?.preserveFilesystemOnDelete;
  return previewChange({
    title: `Delete file system ${cr.metadata.name}`,
    op: 'delete',
    before: cr,
    danger: !keep,
    warning: keep ? undefined : 'The file system and every file in it will be deleted. This cannot be undone.',
    consequences: deleteFilesystemConsequences(cr, opts.pvs),
    typeToConfirm: cr.metadata.name,
    action: 'Delete file system',
    target: `filesystem ${cr.metadata.name}`,
    onDone: () => {
      done(opts.refresh)();
      opts.onDone?.();
    },
  });
}

export function fsBlockers(cr: Obj, pvs: Obj[], svgs: Obj[], nfs: Obj[]): string[] {
  return fsDeleteBlockers(cr.metadata.name, pvs, svgs, nfs);
}

export function createSubvolumeGroup(cr: Obj, opts: { refresh?: () => void; onDone?: () => void }): Promise<boolean> {
  const g = svgGroupName(cr);
  return previewChange({
    title: `Create subvolume group ${cr.metadata.name}`,
    op: 'create',
    after: cr,
    action: 'Create subvolume group',
    target: `subvolumegroup ${cr.spec?.filesystemName}/${g}`,
    consequences: [
      `Rook creates the group ${g} in ${cr.spec?.filesystemName}${cr.spec?.quota ? ` with a ${cr.spec.quota} quota` : ''}.`,
      'Ceph-CSI can then place volumes in it: a StorageClass picks it through the clusterID Rook reports in the resource status.',
    ],
    onDone: () => {
      done(opts.refresh)();
      opts.onDone?.();
    },
  });
}

export function deleteSubvolumeGroup(cr: Obj, opts: { refresh?: () => void; onDone?: () => void }): Promise<boolean> {
  const g = svgGroupName(cr);
  return previewChange({
    title: `Delete subvolume group ${cr.metadata.name}`,
    op: 'delete',
    before: cr,
    danger: true,
    consequences: [
      `Rook removes the group ${g} from ${cr.spec?.filesystemName}.`,
      'Ceph refuses to remove a group that still holds subvolumes; Rook then keeps the resource until they are gone.',
    ],
    typeToConfirm: cr.metadata.name,
    action: 'Delete subvolume group',
    target: `subvolumegroup ${cr.spec?.filesystemName}/${g}`,
    onDone: () => {
      done(opts.refresh)();
      opts.onDone?.();
    },
  });
}

export function svgBlockers(cr: Obj, pvs: Obj[], subvolumes: string[] | null): string[] {
  return svgDeleteBlockers(cr, pvs, subvolumes);
}
