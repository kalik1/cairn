/*
 * Kubernetes reads and writes of the Kubernetes view: polled GETs for the
 * objects useKube() does not list (CSIDriver, CSINode, the ceph-csi
 * operator's CephConnection, ClientProfile and OperatorConfig), and the
 * StorageClass and VolumeSnapshotClass changes, each through the change
 * preview (YAML diff, server-side dry run, Apply).
 */

import React from 'react';
import { classConsequences, ClassForm, pvLabel, WizardContext } from '../model/storageclass';
import { Obj } from '../model/types';
import { previewChange } from '../ui/ChangeDialog';
import { kget } from './client';

export interface GetState<T = any> {
  data: T | null;
  error: string | null;
  loaded: boolean;
  /** 404: the kind (CRD) is not installed. */
  missing: boolean;
  forbidden: boolean;
}

const EMPTY: GetState = { data: null, error: null, loaded: false, missing: false, forbidden: false };

/** Polls several API paths; one state per path. Paths may change between renders. */
export function useKGets(paths: string[], intervalMs = 30000): Record<string, GetState> {
  const sig = paths.join('\n');
  const [state, setState] = React.useState<Record<string, GetState>>({});
  React.useEffect(() => {
    let alive = true;
    const list = sig ? sig.split('\n') : [];
    const load = () =>
      Promise.all(
        list.map(p =>
          kget(p).then(
            data => [p, { data, error: null, loaded: true, missing: false, forbidden: false }] as const,
            (e: any) =>
              [
                p,
                {
                  data: null,
                  error: e?.message ?? String(e),
                  loaded: true,
                  missing: e?.status === 404,
                  forbidden: e?.status === 403,
                },
              ] as const
          )
        )
      ).then(rs => {
        if (alive) setState(Object.fromEntries(rs));
      });
    load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [sig, intervalMs]);
  return state;
}

export function useKGet<T = any>(path: string | null, intervalMs = 30000): GetState<T> {
  const all = useKGets(path ? [path] : [], intervalMs);
  return (path && all[path]) || EMPTY;
}

/** The items of a list answer. */
export const itemsOf = (s: GetState): Obj[] => (s.data?.items ?? []) as Obj[];

/* -------------------------------------------------------- class changes */

/**
 * Previews and creates the StorageClass, then (when asked) its
 * VolumeSnapshotClass. Resolves 'cancelled' when the first preview is
 * closed without applying, so the wizard can reopen with the same form.
 */
export async function createClassFlow(
  sc: Obj,
  vsc: Obj | null,
  form: ClassForm,
  ctx: WizardContext,
  onChanged?: (created: unknown) => void
): Promise<'done' | 'cancelled'> {
  const ok = await previewChange({
    title: `Create StorageClass ${sc.metadata.name}`,
    op: 'create',
    after: sc,
    consequences: classConsequences(form, ctx),
    action: 'Create StorageClass',
    target: `storageclass ${sc.metadata.name}`,
    onDone: onChanged,
  });
  if (!ok) return 'cancelled';
  if (vsc) {
    await previewChange({
      title: `Create VolumeSnapshotClass ${vsc.metadata.name}`,
      op: 'create',
      after: vsc,
      consequences: [
        `VolumeSnapshots of volumes from ${sc.metadata.name} can use it: each snapshot is an RBD or CephFS snapshot made by ${vsc.driver}.`,
        vsc.deletionPolicy === 'Delete'
          ? 'Deleting a VolumeSnapshot deletes the snapshot in Ceph (deletion policy Delete).'
          : 'Deleting a VolumeSnapshot keeps the snapshot in Ceph (deletion policy Retain).',
      ],
      action: 'Create snapshot class',
      target: `volumesnapshotclass ${vsc.metadata.name}`,
      onDone: onChanged,
    });
  }
  return 'done';
}

export function deleteClass(listed: Obj, pending: Obj[], onChanged: () => void): Promise<boolean> {
  // Items of a list answer may lack apiVersion and kind; the delete path needs them.
  const sc: Obj = { ...listed, apiVersion: listed.apiVersion ?? 'storage.k8s.io/v1', kind: listed.kind ?? 'StorageClass' };
  const name = sc.metadata.name;
  return previewChange({
    title: `Delete StorageClass ${name}`,
    op: 'delete',
    before: sc,
    danger: true,
    typeToConfirm: name,
    action: 'Delete StorageClass',
    target: `storageclass ${name}`,
    warning: 'New claims that name this class will stay Pending until a class with this name exists again.',
    consequences: [
      'No volume uses it: no data in Ceph is touched.',
      ...(pending.length ? [`${pending.length} claim(s) waiting for it stay Pending: ${pending.map(p => `${p.metadata.namespace}/${p.metadata.name}`).join(', ')}.`] : []),
    ],
    onDone: onChanged,
  });
}

export function deleteSnapshotClass(listed: Obj, serves: string[], onChanged?: () => void): Promise<boolean> {
  const vsc: Obj = { ...listed, apiVersion: listed.apiVersion ?? 'snapshot.storage.k8s.io/v1', kind: listed.kind ?? 'VolumeSnapshotClass' };
  const name = vsc.metadata.name;
  return previewChange({
    title: `Delete VolumeSnapshotClass ${name}`,
    op: 'delete',
    before: vsc,
    danger: true,
    typeToConfirm: name,
    action: 'Delete snapshot class',
    target: `volumesnapshotclass ${name}`,
    consequences: [
      'Existing snapshots stay; their VolumeSnapshotContents keep working.',
      serves.length
        ? `New VolumeSnapshots of ${serves.join(', ')} volumes that name this class will fail until another class serves them.`
        : 'No Ceph StorageClass uses this driver now.',
    ],
    onDone: onChanged,
  });
}

/** "demo/a, demo/b and 4 more" for a list of PVs. */
export function pvList(pvs: Obj[], max = 4): string {
  const names = pvs.map(pvLabel);
  return names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', ');
}
