/*
 * Cairn is one Headlamp route, /ceph/:view?/:a?/:b?/:c?, so the shell
 * (live polling, chart history) stays mounted while you move. The stable
 * URLs other plugins link to:
 *
 *   /c/<cluster>/ceph                    overview
 *   /c/<cluster>/ceph/osds               hosts and OSDs
 *   /c/<cluster>/ceph/pools/<pool>       a pool
 *   /c/<cluster>/ceph/rbd/<pool>/<image> an RBD image
 */

import { Router } from '@kinvolk/headlamp-plugin/lib';
import { useHistory, useParams } from 'react-router-dom';

export const ROUTE_NAME = 'cairn';
export const ROUTE_PATH = '/ceph/:view?/:a?/:b?/:c?';

export type View =
  | 'overview'
  | 'osds'
  | 'daemons'
  | 'pools'
  | 'rbd'
  | 'cephfs'
  | 'object'
  | 'kubernetes'
  | 'security'
  | 'config'
  | 'activity';

export const VIEWS: View[] = ['overview', 'osds', 'daemons', 'pools', 'rbd', 'cephfs', 'object', 'kubernetes', 'security', 'config', 'activity'];

export interface Nav {
  view: View;
  a?: string;
  b?: string;
  c?: string;
  href: (view: View, a?: string, b?: string, c?: string) => string;
  go: (view: View, a?: string, b?: string, c?: string) => void;
}

export function hrefFor(view: View, a?: string, b?: string, c?: string): string {
  const params: Record<string, string> = {};
  if (view !== 'overview') params.view = view;
  if (a) params.a = a;
  if (b) params.b = b;
  if (c) params.c = c;
  return Router.createRouteURL(ROUTE_NAME, params);
}

export function useNav(): Nav {
  const p = useParams<{ view?: string; a?: string; b?: string; c?: string }>();
  const history = useHistory();
  const view = (VIEWS.includes(p.view as View) ? p.view : 'overview') as View;
  const dec = (s?: string) => (s === undefined ? undefined : safeDecode(s));
  return {
    view,
    a: dec(p.a),
    b: dec(p.b),
    c: dec(p.c),
    href: hrefFor,
    go: (v, a, b, c) => history.push(hrefFor(v, a, b, c)),
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const poolHref = (pool: string) => hrefFor('pools', pool);
/** An image; `ns` is its RADOS namespace when not the default one. */
export const imageHref = (pool: string, image: string, ns?: string) => hrefFor('rbd', pool, image, ns || undefined);
export const osdHref = (id: number) => hrefFor('osds', String(id));
