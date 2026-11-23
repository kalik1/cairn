/*
 * Block (RBD): /ceph/rbd[/<pool>] lists the images of a pool,
 * /ceph/rbd/<pool>/<image>[/<namespace>] is one image (a stable URL other
 * plugins link to).
 */

import React from 'react';
import { ImageList } from './ImageList';
import { ImagePage } from './ImagePage';

export function RbdView({ pool, image, ns }: { pool?: string; image?: string; ns?: string }) {
  return pool && image ? <ImagePage pool={pool} image={image} ns={ns ?? ''} /> : <ImageList pool={pool} />;
}
