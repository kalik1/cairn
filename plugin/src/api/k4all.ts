/*
 * Whether k4all runs this cluster: discovery serves its API group. Without
 * it, every field is Cairn's, whatever managedFields say (k4all spec §4 R9,
 * src/model/ownership.ts).
 */

import React from 'react';
import { K4ALL_GROUP } from '../model/ownership';
import { currentCluster, kreq } from './client';

const cache = new Map<string, Promise<boolean>>();

/** k4all runs the current cluster. Discovery is open to every authenticated user: 200 when the group exists. */
export function isK4all(): Promise<boolean> {
  const cluster = currentCluster();
  let p = cache.get(cluster);
  if (!p) {
    p = kreq(`/apis/${K4ALL_GROUP}`).then(
      () => true,
      (e: any) => e?.status === 403
    );
    cache.set(cluster, p);
  }
  return p;
}

/** k4all runs the current cluster; false until discovery answers. */
export function useK4all(): boolean {
  const [on, setOn] = React.useState(false);
  const cluster = currentCluster();
  React.useEffect(() => {
    let alive = true;
    isK4all().then(v => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, [cluster]);
  return on;
}
