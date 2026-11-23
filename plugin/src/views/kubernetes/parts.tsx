/*
 * Small pieces the Kubernetes and Configuration views share: sub-tabs that
 * are links (/ceph/<view>/<tab>), a search field, a compact select, a
 * router link, a pre-formatted block.
 */

import { Icon } from '@iconify/react';
import Box, { BoxProps } from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import MuiLink from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { hrefFor, useNav, View } from '../../shell/nav';
import { useTokens } from '../../ui/useTokens';

export interface SubTab {
  id: string;
  label: string;
  /** A count or a short word after the label. */
  badge?: React.ReactNode;
}

export function SubTabs({ view, tabs, current, label }: { view: View; tabs: SubTab[]; current: string; label: string }) {
  const t = useTokens();
  const nav = useNav();
  return (
    <Box sx={{ borderBottom: `1px solid ${t.rule}`, mt: -1 }}>
      <Tabs
        value={current}
        aria-label={label}
        variant="scrollable"
        scrollButtons={false}
        sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 14, minWidth: 0, px: 1.5 } }}
      >
        {tabs.map(tab => (
          <Tab
            key={tab.id}
            value={tab.id}
            component="a"
            href={hrefFor(view, tab.id)}
            onClick={(e: React.MouseEvent) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              nav.go(view, tab.id);
            }}
            label={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                {tab.label}
                {tab.badge !== undefined && tab.badge !== null && (
                  <Box component="span" sx={{ fontSize: 12, color: t.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {tab.badge}
                  </Box>
                )}
              </Box>
            }
          />
        ))}
      </Tabs>
    </Box>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  width = 260,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
  name?: string;
}) {
  return (
    <TextField
      size="small"
      variant="outlined"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      inputProps={{ 'aria-label': placeholder, name }}
      sx={{ width, '& .MuiInputBase-input': { py: 0.6, fontSize: 13.5 } }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <Icon icon="mdi:magnify" width={17} />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <Box
              component="button"
              type="button"
              aria-label="Clear search"
              onClick={() => onChange('')}
              sx={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', '&:focus-visible': { outline: '2px solid', outlineOffset: 2 } }}
            >
              <Icon icon="mdi:close" width={16} />
            </Box>
          </InputAdornment>
        ) : undefined,
      }}
    />
  );
}

export function SmallSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  width = 180,
  name,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  label: string;
  width?: number;
  name?: string;
}) {
  return (
    <TextField
      select
      size="small"
      variant="outlined"
      label={label}
      value={value}
      onChange={e => onChange(e.target.value as T)}
      inputProps={{ name }}
      InputLabelProps={{ shrink: true }}
      sx={{ width, '& .MuiInputBase-input': { py: 0.6, fontSize: 13.5 } }}
      SelectProps={{ displayEmpty: true, MenuProps: { disableScrollLock: true } }}
    >
      {options.map(o => (
        <MenuItem key={o.value || '__all'} value={o.value} sx={{ fontSize: 13.5 }}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** A link inside Cairn (no page reload). */
export function CLink({ to, children, title }: { to: string; children: React.ReactNode; title?: string }) {
  return (
    <MuiLink
      component={RouterLink}
      to={to}
      title={title}
      underline="always"
      sx={{ color: 'inherit', textDecorationColor: 'rgba(127,127,127,0.55)', textUnderlineOffset: '3px', '&:hover': { textDecorationColor: 'currentColor' } }}
    >
      {children}
    </MuiLink>
  );
}

/** A block of pre-formatted text (YAML, long values). */
export function Pre({ children, sx, label }: { children: React.ReactNode; sx?: BoxProps['sx']; label?: string }) {
  const t = useTokens();
  return (
    <Box
      component="pre"
      aria-label={label}
      sx={{
        m: 0,
        p: 1.25,
        overflow: 'auto',
        fontFamily: t.font.mono,
        fontSize: 12.5,
        lineHeight: 1.5,
        background: t.sunken,
        border: `1px solid ${t.rule}`,
        borderRadius: `${t.radius.small}px`,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

/** Two columns: main content and a side panel; stacks below ~1100 px. */
export function Split({ children, side, sideWidth = 400 }: { children: React.ReactNode; side: React.ReactNode; sideWidth?: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: `minmax(0, 1fr) minmax(300px, ${sideWidth}px)` },
        alignItems: 'start',
      }}
    >
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
      <Box sx={{ minWidth: 0, position: { lg: 'sticky' }, top: { lg: 8 }, display: 'flex', flexDirection: 'column', gap: 2 }}>{side}</Box>
    </Box>
  );
}

/** Yes/No words for booleans. */
export const yesNo = (b: boolean | undefined | null, yes = 'Yes', no = 'No') => (b === undefined || b === null ? '—' : b ? yes : no);
