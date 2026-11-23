/*
 * Object storage live data (radosgw-admin through the bridge) and the
 * "Show keys" panel: S3 credentials read from the Secret only on an
 * explicit click, after an access review, shown in this component only and
 * hidden again (on click, after two minutes, or when it unmounts).
 */

import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import React from 'react';
import { out, outError, useCeph, useCephQuery } from '../../api/ceph';
import { OBJECT_KEY, readCredentials, storeQueries, USER_INFO_LIMIT, userInfoQueries } from '../../api/objectOps';
import { useCanState } from '../../api/permissions';
import { Bucket, parseBucketStats, parseRgwUser, parseUidList, RgwUser } from '../../model/object';
import { Obj } from '../../model/types';
import { Action, IconAction, KV, Mono, Notice } from '../../ui/kit';
import { useTokens } from '../../ui/useTokens';

export interface StoreLive {
  uids: string[] | null;
  buckets: Bucket[] | null;
  infos: Map<string, RgwUser>;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Users, buckets and user details of a store (radosgw-admin). */
export function useStoreLive(store: Obj | undefined, withUsers = true): StoreLive {
  const c = useCeph();
  const on = c.phase === 'ready' && !!store && store.status?.phase === 'Ready';
  const name = store?.metadata.name ?? '';
  const q = useCephQuery(`${OBJECT_KEY}:${name}:base`, on && store ? storeQueries(store) : null, { intervalMs: 30000, staleMs: 15000 });
  const uids = React.useMemo(() => (out(q.data, 0) !== undefined ? parseUidList(out(q.data, 0)) : null), [q.data]);
  const buckets = React.useMemo(() => (out(q.data, 1) !== undefined ? parseBucketStats(out(q.data, 1)) : null), [q.data]);
  const shown = (uids ?? []).slice(0, USER_INFO_LIMIT);
  const q2 = useCephQuery(`${OBJECT_KEY}:${name}:users:${shown.join(',')}`, on && withUsers && store && shown.length ? userInfoQueries(store, shown) : null, {
    intervalMs: 60000,
    staleMs: 15000,
  });
  const infos = React.useMemo(() => {
    const m = new Map<string, RgwUser>();
    shown.forEach((uid, i) => {
      const o = out(q2.data, i);
      if (o) m.set(uid, parseRgwUser(o));
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.join(','), q2.data]);
  return {
    uids,
    buckets,
    infos,
    error: outError(q.data, 0) ?? outError(q.data, 1) ?? q.error,
    loading: q.loading,
    refresh: () => {
      q.refresh();
      q2.refresh();
    },
  };
}

/* ------------------------------------------------------------ keys */

const MASK = '••••••••••••••••';
const HIDE_AFTER_MS = 120000;

function SecretValue({ value }: { value: string | null }) {
  const t = useTokens();
  return (
    <Box
      component="code"
      data-cairn-secret={value ? 'shown' : 'hidden'}
      sx={{ fontFamily: t.font.mono, fontSize: '0.92em', overflowWrap: 'anywhere', color: value ? 'inherit' : t.muted, letterSpacing: value ? 0 : '0.08em' }}
    >
      {value ?? MASK}
    </Box>
  );
}

/**
 * The S3 keys of a Secret, masked until "Show keys". Reading needs get on
 * that Secret; the button says so when the role lacks it.
 */
export function ShowKeys({ namespace, secret, what }: { namespace: string; secret: string; what: string }) {
  const t = useTokens();
  const allowed = useCanState({ verb: 'get', group: '', resource: 'secrets', namespace, name: secret });
  const [creds, setCreds] = React.useState<{ accessKey: string; secretKey: string; endpoint: string } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState('');

  React.useEffect(() => {
    if (!creds) return;
    const id = window.setTimeout(() => setCreds(null), HIDE_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [creds]);
  // Different Secret: forget what was shown.
  React.useEffect(() => {
    setCreds(null);
    setErr(null);
  }, [namespace, secret]);

  const show = async () => {
    setBusy(true);
    setErr(null);
    try {
      setCreds(await readCredentials(namespace, secret));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (label: string, v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setErr('The browser did not allow copying to the clipboard.');
    }
  };

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <KV
        labelWidth={130}
        rows={[
          ['Secret', <Mono key="s">{`${namespace}/${secret}`}</Mono>],
          [
            'Access key',
            <Box key="a" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SecretValue value={creds?.accessKey ?? null} />
              {creds && <IconAction icon={copied === 'a' ? 'mdi:check' : 'mdi:content-copy'} label="Copy the access key" size={15} onClick={() => copy('a', creds.accessKey)} />}
            </Box>,
          ],
          [
            'Secret key',
            <Box key="k" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SecretValue value={creds?.secretKey ?? null} />
              {creds && <IconAction icon={copied === 'k' ? 'mdi:check' : 'mdi:content-copy'} label="Copy the secret key" size={15} onClick={() => copy('k', creds.secretKey)} />}
            </Box>,
          ],
          !!creds?.endpoint && ['Endpoint', <Mono key="e">{creds.endpoint}</Mono>],
        ]}
      />
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {creds ? (
          <Action icon="mdi:eye-off-outline" onClick={() => setCreds(null)}>
            Hide keys
          </Action>
        ) : (
          <Action
            icon="mdi:eye-outline"
            onClick={show}
            disabled={busy}
            reason={allowed === false ? `Your role may not read the Secret ${namespace}/${secret} (get secrets)` : null}
          >
            Show keys
          </Action>
        )}
        <Box sx={{ fontSize: 12.5, color: t.muted }}>
          {creds
            ? 'Shown on this page only; hidden again in two minutes.'
            : `The keys of ${what} stay in the Secret; Cairn reads it only when you ask.`}
        </Box>
      </Box>
      {err && (
        <Notice tone="err" icon="mdi:lock-outline">
          {err}
        </Notice>
      )}
    </Box>
  );
}

/** A small key icon with the count of S3 keys (never the keys). */
export function KeyCount({ n }: { n: number }) {
  const t = useTokens();
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: n ? undefined : t.muted }}>
      <Icon icon="mdi:key-outline" width={14} aria-hidden />
      {n}
    </Box>
  );
}
