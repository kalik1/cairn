/*
 * The Rook operator: its Deployment and pods, in the CephCluster namespace
 * or (when it runs elsewhere) found by label across the cluster, polled
 * once a minute.
 */

import React from 'react';
import { kget } from '../../api/client';
import { useKube } from '../../api/kube';
import { Obj } from '../../model/types';

export interface OperatorInfo {
  deployment: Obj | null;
  pods: Obj[];
  /** We could look (lists loaded or the cluster-wide lookup answered). */
  looked: boolean;
  namespace: string;
}

export function useOperator(): OperatorInfo {
  const kube = useKube();
  const local = kube.deployments.items.find(d => d.metadata.name === 'rook-ceph-operator') ?? null;
  const localPods = kube.rookPods.items.filter(p => p.metadata.labels?.app === 'rook-ceph-operator');
  const [remote, setRemote] = React.useState<{ deployment: Obj | null; pods: Obj[]; looked: boolean; namespace: string } | null>(null);
  const needRemote = kube.deployments.loaded && !local && localPods.length === 0;
  React.useEffect(() => {
    if (!needRemote) return;
    let alive = true;
    const look = async () => {
      try {
        const list = await kget('/api/v1/pods', { labelSelector: 'app=rook-ceph-operator' });
        const pods: Obj[] = list?.items ?? [];
        const ns = pods[0]?.metadata?.namespace ?? '';
        let deployment: Obj | null = null;
        if (ns) deployment = await kget(`/apis/apps/v1/namespaces/${ns}/deployments/rook-ceph-operator`).catch(() => null);
        if (alive) setRemote({ deployment, pods, looked: true, namespace: ns });
      } catch {
        if (alive) setRemote({ deployment: null, pods: [], looked: false, namespace: '' });
      }
    };
    look();
    const id = window.setInterval(look, 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [needRemote]);
  const looked = kube.deployments.loaded && kube.rookPods.loaded;
  const podSig = localPods.map(p => `${p.metadata.uid}:${p.metadata.resourceVersion}`).join(',');
  return React.useMemo(
    () =>
      needRemote
        ? remote ?? { deployment: null, pods: [], looked: false, namespace: '' }
        : { deployment: local, pods: localPods, looked, namespace: kube.ns },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needRemote, remote, local, podSig, looked, kube.ns]
  );
}
