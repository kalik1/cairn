/*
 * What the current user may do, from SelfSubjectAccessReviews, cached per
 * cluster for a few minutes. Controls a user may not use are disabled with
 * the reason instead of failing after a click.
 */

import React from 'react';
import { currentCluster, kpost } from './client';

export interface Attrs {
  verb: string;
  group: string;
  resource: string;
  subresource?: string;
  namespace?: string;
  name?: string;
}

const cache = new Map<string, { at: number; p: Promise<boolean> }>();
const TTL = 5 * 60 * 1000;

export function can(a: Attrs): Promise<boolean> {
  const k = `${currentCluster()}|${a.verb}|${a.group}|${a.resource}|${a.subresource ?? ''}|${a.namespace ?? ''}|${a.name ?? ''}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = kpost('/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SelfSubjectAccessReview',
    spec: {
      resourceAttributes: {
        verb: a.verb,
        group: a.group,
        resource: a.resource,
        subresource: a.subresource,
        namespace: a.namespace,
        name: a.name,
      },
    },
  })
    .then(r => !!r?.status?.allowed)
    // If the review itself fails, do not block: the API will refuse if it must.
    .catch(() => true);
  cache.set(k, { at: Date.now(), p });
  return p;
}

/** Forget cached answers (after a role change, or on "Check again"). */
export function clearPermissionCache() {
  cache.clear();
}

/** true/false once known; null while loading. */
export function useCanState(a: Attrs | null): boolean | null {
  const [ok, setOk] = React.useState<boolean | null>(null);
  const sig = a ? JSON.stringify(a) : '';
  React.useEffect(() => {
    if (!a) return;
    let alive = true;
    can(a).then(v => alive && setOk(v));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return a ? ok : null;
}

/** true/false once known; true while loading so controls do not flicker. */
export function useCan(a: Attrs | null): boolean {
  return useCanState(a) !== false;
}

export const NOT_ALLOWED = 'Your role does not allow this';

/** The reason a control is disabled, or null when allowed. */
export function denied(ok: boolean, what?: string): string | null {
  return ok ? null : what ? `Your role does not allow ${what}` : NOT_ALLOWED;
}

/** Shorthand for a Rook custom resource permission in a namespace. */
export function rookAttrs(verb: string, resource: string, namespace?: string): Attrs {
  return { verb, group: 'ceph.rook.io', resource, namespace };
}
