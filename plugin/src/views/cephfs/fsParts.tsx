/*
 * CephFS live data hooks and the pieces drawn on the basalt band: ranks
 * as stones, standbys, figures.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { out, outError, useCeph, useCephQuery } from '../../api/ceph';
import { FS_KEY, fsDumpQuery, fsGroupDetailQueries, fsGroupsQueries, fsStatusQueries, SUBVOLUME_INFO_LIMIT, subvolumeInfoQueries } from '../../api/fsOps';
import {
  CephFs,
  FsMap,
  FsRank,
  MdsDaemon,
  mdsTone,
  mdsWord,
  NO_GROUP,
  parseFsDump,
  parseFsStatus,
  parseGroupInfo,
  parseNameList,
  parseSubvolumeInfo,
  Subvolume,
  SubvolumeGroup,
  withStatus,
} from '../../model/cephfs';
import { count } from '../../model/format';
import { Mark } from '../../ui/Mark';
import { STATE, tabular } from '../../ui/tokens';
import { useTokens } from '../../ui/useTokens';

/* ---------------------------------------------------------------- hooks */

export function useFsMap(): { map: FsMap | null; filesystems: CephFs[]; error: string | null; loading: boolean; refresh: () => void } {
  const c = useCeph();
  const ready = c.phase === 'ready';
  const dump = useCephQuery(`${FS_KEY}:dump`, ready ? fsDumpQuery : null, { intervalMs: 15000 });
  const map = React.useMemo(() => {
    const o = out(dump.data);
    return o ? parseFsDump(o) : null;
  }, [dump.data]);
  const names = map?.filesystems.map(f => f.name) ?? [];
  const st = useCephQuery(`${FS_KEY}:status:${names.join(',')}`, ready && names.length ? fsStatusQueries(names) : null, { intervalMs: 15000 });
  const filesystems = React.useMemo(
    () =>
      (map?.filesystems ?? []).map((f, i) => {
        const o = out(st.data, i);
        return withStatus(f, o ? parseFsStatus(o, f.name) : null);
      }),
    [map, st.data]
  );
  const refresh = React.useCallback(() => {
    dump.refresh();
    st.refresh();
  }, [dump, st]);
  return { map, filesystems, error: outError(dump.data) ?? dump.error, loading: dump.loading, refresh };
}

export interface GroupRow extends SubvolumeGroup {
  subvolumes: string[];
  error?: string | null;
}

export function useFsGroups(fs: string, enabled: boolean) {
  const c = useCeph();
  const on = enabled && c.phase === 'ready';
  const q1 = useCephQuery(`${FS_KEY}:groups:${fs}`, on ? fsGroupsQueries(fs) : null, { intervalMs: 30000 });
  const groupNames = React.useMemo(() => parseNameList(out(q1.data, 0) ?? []), [q1.data]);
  const loose = React.useMemo(() => parseNameList(out(q1.data, 1) ?? []), [q1.data]);
  const q2 = useCephQuery(`${FS_KEY}:groupinfo:${fs}:${groupNames.join(',')}`, on && groupNames.length ? fsGroupDetailQueries(fs, groupNames) : null, {
    intervalMs: 30000,
  });
  const groups: GroupRow[] = React.useMemo(
    () =>
      groupNames.map((g, i) => {
        const info = out(q2.data, 2 * i);
        return {
          ...(info ? parseGroupInfo(info, g) : { name: g, usedBytes: null, quotaBytes: null, dataPool: '', mode: '', created: null }),
          subvolumes: parseNameList(out(q2.data, 2 * i + 1) ?? []),
          error: outError(q2.data, 2 * i),
        };
      }),
    [groupNames, q2.data]
  );
  const subs = React.useMemo(
    () => [...groups.flatMap(g => g.subvolumes.map(name => ({ group: g.name, name }))), ...loose.map(name => ({ group: '', name }))],
    [groups, loose]
  );
  const shown = subs.slice(0, SUBVOLUME_INFO_LIMIT);
  const sig = shown.map(s => `${s.group}/${s.name}`).join(',');
  const q3 = useCephQuery(`${FS_KEY}:subinfo:${fs}:${sig}`, on && shown.length ? subvolumeInfoQueries(fs, shown) : null, { intervalMs: 60000 });
  const subvolumes: Subvolume[] = React.useMemo(
    () =>
      shown.map((s, i) => {
        const o = out(q3.data, i);
        const g = s.group || NO_GROUP;
        if (o) return parseSubvolumeInfo(o, s.name, g);
        return {
          name: s.name,
          group: g,
          usedBytes: null,
          quotaBytes: null,
          path: '',
          state: '',
          type: '',
          dataPool: '',
          poolNamespace: '',
          created: null,
          features: [],
          error: outError(q3.data, i) ?? undefined,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, q3.data]
  );
  return {
    groups,
    subvolumes,
    total: subs.length,
    truncated: subs.length > shown.length,
    error: outError(q1.data) ?? q1.error,
    loading: q1.loading || (groupNames.length > 0 && !q2.data) || (shown.length > 0 && !q3.data && q3.loading),
    refresh: () => {
      q1.refresh();
      q2.refresh();
      q3.refresh();
    },
  };
}

/* ------------------------------------------------------- band pieces */

/** A rank as a stone: rank number, the MDS holding it, its state and activity. */
export function RankStone({ rank, large }: { rank: FsRank; large?: boolean }) {
  const t = useTokens();
  const tone = mdsTone(rank.state);
  return (
    <Box
      sx={{
        minWidth: large ? 168 : 128,
        px: 1.25,
        py: large ? 1.1 : 0.75,
        borderRadius: `${t.radius.panel}px`,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderLeft: `3px solid ${STATE[tone]}`,
        display: 'grid',
        gap: 0.25,
        ...tabular,
      }}
    >
      <Box sx={{ fontSize: 12, color: t.basaltMuted }}>Rank {rank.rank}</Box>
      <Box sx={{ fontFamily: t.font.mono, fontSize: large ? 14 : 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rank.mds ?? 'no MDS'}</Box>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 13 }}>
        <Mark tone={tone} size={8} />
        {mdsWord(rank.state)}
      </Box>
      {large && rank.dns !== undefined && (
        <Box sx={{ fontSize: 12, color: t.basaltMuted }}>
          {count(rank.rate ?? 0)} req/s, {count(rank.dns)} dentries, {count(rank.inos)} inodes, {count(rank.caps)} caps
        </Box>
      )}
    </Box>
  );
}

/** A standby MDS as a small hollow stone. */
export function StandbyStone({ d }: { d: MdsDaemon }) {
  const t = useTokens();
  const tone = mdsTone(d.state);
  return (
    <Box
      sx={{
        px: 1,
        py: 0.6,
        borderRadius: `${t.radius.panel}px`,
        border: '1px dashed rgba(255,255,255,0.22)',
        display: 'grid',
        gap: 0.25,
        minWidth: 112,
      }}
    >
      <Box sx={{ fontFamily: t.font.mono, fontSize: 12.5 }}>{d.name}</Box>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 12.5, color: t.basaltMuted }}>
        <Mark tone={tone} size={8} />
        {d.state === 'standby-replay' ? `Following rank ${d.rank}` : mdsWord(d.state)}
      </Box>
    </Box>
  );
}

/** A figure on the band: value large, label small, basalt colours. */
export function BandFigure({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  const t = useTokens();
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2, ...tabular }}>{value}</Box>
      <Box sx={{ fontSize: 12.5, color: t.basaltMuted }}>{label}</Box>
    </Box>
  );
}

/** A link inside Cairn (keeps the single-page route). */
export function Go({ to, children, sx }: { to: string; children: React.ReactNode; sx?: any }) {
  return (
    <Box component={RouterLink} to={to} sx={{ color: 'inherit', textDecorationColor: 'currentColor', textUnderlineOffset: 2, ...sx }}>
      {children}
    </Box>
  );
}
