/*
 * Thin wrappers over Headlamp's clusterRequest: Cairn always talks to the
 * cluster of the current route, with Headlamp's own auth (kubeconfig
 * headers or the HttpOnly cookie of a token login), so the plugin never
 * handles Kubernetes tokens.
 */

import { ApiProxy, Utils } from '@kinvolk/headlamp-plugin/lib';

export function currentCluster(): string {
  return (Utils.getCluster?.() as string | null) || '';
}

type Init = {
  method?: string;
  body?: unknown;
  contentType?: string;
  json?: boolean;
  query?: Record<string, string>;
  timeout?: number;
};

export async function kreq<T = any>(path: string, init: Init = {}): Promise<T> {
  const { method = 'GET', body, contentType = 'application/json', json = true, query, timeout } = init;
  // Some subresources answer 406 to a strict "Accept: application/json":
  // stay lenient.
  const headers: Record<string, string> = { Accept: json ? 'application/json, */*' : '*/*' };
  if (body !== undefined) headers['Content-Type'] = contentType;
  const res = await ApiProxy.clusterRequest(
    path,
    {
      method,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      headers,
      cluster: currentCluster(),
      isJSON: json,
      autoLogoutOnAuthError: false,
      ...(timeout ? { timeout } : {}),
    } as any,
    query as any
  );
  return res as T;
}

/** GET returning text (Prometheus metrics, logs). */
export async function ktext(path: string, query?: Record<string, string>): Promise<string> {
  const res: Response = await kreq(path, { json: false, query });
  return res.text();
}

export function kget<T = any>(path: string, query?: Record<string, string>): Promise<T> {
  return kreq<T>(path, { query });
}

export function kpost<T = any>(path: string, body: unknown, query?: Record<string, string>): Promise<T> {
  return kreq<T>(path, { method: 'POST', body, query });
}

export function kput<T = any>(path: string, body: unknown, query?: Record<string, string>): Promise<T> {
  return kreq<T>(path, { method: 'PUT', body, query });
}

export function kmerge<T = any>(path: string, patch: unknown, query?: Record<string, string>): Promise<T> {
  return kreq<T>(path, { method: 'PATCH', body: patch, contentType: 'application/merge-patch+json', query });
}

export function kjsonpatch<T = any>(path: string, ops: unknown[], query?: Record<string, string>): Promise<T> {
  return kreq<T>(path, { method: 'PATCH', body: ops, contentType: 'application/json-patch+json', query });
}

export function kdelete(path: string, body?: unknown, query?: Record<string, string>): Promise<unknown> {
  return kreq(path, { method: 'DELETE', body, json: true, query });
}

/** Query for a server-side dry run: the API server validates and admits, nothing is stored. */
export const DRY_RUN = { dryRun: 'All' } as const;

/** API path of a namespaced or cluster object. */
export function objPath(apiVersion: string, plural: string, name?: string, namespace?: string): string {
  const base = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
  const ns = namespace ? `/namespaces/${namespace}` : '';
  return `${base}${ns}/${plural}${name ? `/${name}` : ''}`;
}

/** A readable message from an API error ("Forbidden - …" → the part after the dash). */
export function errorText(err: unknown): string {
  const e = err as { status?: number; message?: string };
  const msg = e?.message ?? String(err);
  const detail = msg.includes(' - ') ? msg.split(' - ').slice(1).join(' - ') : msg;
  if (e?.status === 403) return `Not allowed: ${detail}`;
  if (e?.status === 409) return `Changed meanwhile: ${detail}`;
  return detail || 'The request failed';
}
