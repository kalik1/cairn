/*
 * Pools: /ceph/pools lists every pool, /ceph/pools/<pool> is one pool
 * (a stable URL other plugins link to).
 */

import React from 'react';
import { PoolList } from './PoolList';
import { PoolPage } from './PoolPage';

export function PoolsView({ pool }: { pool?: string }) {
  return pool ? <PoolPage name={pool} /> : <PoolList />;
}
