/*
 * Cairn's small UI kit: pages, panels, key/value rows, meters, notices,
 * toolbars, empty states, sparklines, identifiers. Quiet by design; the
 * basalt band (<Band/>) is the one loud element of a screen.
 */

import { Icon } from '@iconify/react';
import Box, { BoxProps } from '@mui/material/Box';
import Button, { ButtonProps } from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import React from 'react';
import { STATE, stateText, StateTone, tabular } from './tokens';
import { useTokens } from './useTokens';

/* ----------------------------------------------------------------- page */

/** A view's content area: title row, optional actions, then the body. */
export function Page({
  title,
  subtitle,
  actions,
  children,
  maxWidth = 1680,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const t = useTokens();
  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2.5, maxWidth, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {(title || actions) && (
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {title && (
              <Typography component="h1" sx={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.01em', lineHeight: 1.25 }}>
                {title}
              </Typography>
            )}
            {subtitle && <Typography sx={{ color: t.muted, fontSize: 14, mt: 0.25, maxWidth: 900 }}>{subtitle}</Typography>}
          </Box>
          {actions && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</Box>}
        </Box>
      )}
      {children}
    </Box>
  );
}

/** Responsive grid of panels. */
export function Grid({ min = 320, gap = 2, children, sx }: { min?: number; gap?: number; children: React.ReactNode; sx?: BoxProps['sx'] }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, gap, ...sx }}>
      {children}
    </Box>
  );
}

/* ---------------------------------------------------------------- panel */

export function Panel({
  title,
  icon,
  actions,
  children,
  dense,
  sx,
  footer,
  id,
}: {
  title?: React.ReactNode;
  icon?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  dense?: boolean;
  sx?: BoxProps['sx'];
  footer?: React.ReactNode;
  id?: string;
}) {
  const t = useTokens();
  return (
    <Box
      component="section"
      id={id}
      sx={{
        border: `1px solid ${t.rule}`,
        borderRadius: `${t.radius.panel}px`,
        background: t.surface,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        ...sx,
      }}
    >
      {(title || actions) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, minHeight: 44, borderBottom: `1px solid ${t.rule}` }}>
          {icon && <Icon icon={icon} width={18} style={{ color: t.muted, flex: 'none' }} />}
          <Typography component="h2" sx={{ fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
            {title}
          </Typography>
          {actions}
        </Box>
      )}
      <Box sx={{ p: dense ? 0 : 2, flex: 1, minWidth: 0 }}>{children}</Box>
      {footer && <Box sx={{ px: 2, py: 1, borderTop: `1px solid ${t.rule}` }}>{footer}</Box>}
    </Box>
  );
}

/**
 * The basalt band: the one loud element of a screen (health verdict and
 * PG field, host shelves, pool strata). Always dark, like rock.
 */
export function Band({ children, sx }: { children: React.ReactNode; sx?: BoxProps['sx'] }) {
  const t = useTokens();
  return (
    <Box
      sx={{
        background: t.basalt,
        color: t.basaltText,
        border: `1px solid ${t.basaltEdge}`,
        borderRadius: `${t.radius.panel + 2}px`,
        p: { xs: 2, md: 3 },
        position: 'relative',
        overflow: 'hidden',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

/* ------------------------------------------------------- key/value rows */

export function KV({ rows, labelWidth = 160 }: { rows: ([React.ReactNode, React.ReactNode] | null | false)[]; labelWidth?: number }) {
  const t = useTokens();
  return (
    <Box
      component="dl"
      sx={{ m: 0, display: 'grid', gridTemplateColumns: `minmax(110px, ${labelWidth}px) 1fr`, columnGap: 2, rowGap: 0.75, fontSize: 13.5 }}
    >
      {rows
        .filter((r): r is [React.ReactNode, React.ReactNode] => !!r)
        .map(([k, v], i) => (
          <React.Fragment key={i}>
            <Box component="dt" sx={{ color: t.muted, m: 0 }}>
              {k}
            </Box>
            <Box component="dd" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere', ...tabular }}>
              {v ?? '—'}
            </Box>
          </React.Fragment>
        ))}
    </Box>
  );
}

/* ---------------------------------------------------------------- meter */

/**
 * Capacity meter: `used` solid, `allocated` (reserved, provisioned) hatched
 * lighter, on the track of `total`. Label left, numbers right.
 */
export function Meter({
  label,
  used,
  allocated,
  total,
  format,
  warnAt = 75,
  errAt = 85,
  caption,
  height = 8,
}: {
  label?: React.ReactNode;
  used?: number;
  allocated?: number;
  total: number;
  format: (n: number) => string;
  warnAt?: number;
  errAt?: number;
  caption?: React.ReactNode;
  height?: number;
}) {
  const t = useTokens();
  const p = (n?: number) => (total > 0 && n !== undefined && isFinite(n) ? Math.min(100, (n / total) * 100) : 0);
  const usedPct = p(used);
  const allocPct = p(allocated);
  const color = usedPct >= errAt ? STATE.err : usedPct >= warnAt ? STATE.warn : t.meterUsed;
  const main = used !== undefined ? used : allocated;
  return (
    <Box sx={{ minWidth: 0 }}>
      {label !== undefined && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
          <Typography component="div" sx={{ fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
            {label}
          </Typography>
          <Typography sx={{ fontSize: 13, color: t.muted, ...tabular }} noWrap>
            {main !== undefined ? format(main) : '—'} of {format(total)}
          </Typography>
        </Box>
      )}
      <Box
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.max(usedPct, allocPct))}
        aria-label={typeof label === 'string' ? label : 'Usage'}
        sx={{ position: 'relative', height, borderRadius: 1, background: t.meterTrack, overflow: 'hidden' }}
      >
        {allocated !== undefined && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              width: `${allocPct}%`,
              background: `repeating-linear-gradient(135deg, ${t.meterAlloc} 0 4px, transparent 4px 7px)`,
              borderRight: allocPct > 0 ? `1px solid ${t.meterUsed}` : 'none',
            }}
          />
        )}
        {used !== undefined && <Box sx={{ position: 'absolute', inset: 0, width: `${usedPct}%`, background: color }} />}
      </Box>
      {caption && <Typography sx={{ fontSize: 12.5, color: t.muted, mt: 0.5, ...tabular }}>{caption}</Typography>}
    </Box>
  );
}

/** A compact inline bar (for table cells). */
export function MiniBar({ pct, width = 64, warnAt = 75, errAt = 85 }: { pct: number; width?: number; warnAt?: number; errAt?: number }) {
  const t = useTokens();
  const v = Math.max(0, Math.min(100, isFinite(pct) ? pct : 0));
  const color = v >= errAt ? STATE.err : v >= warnAt ? STATE.warn : t.meterUsed;
  return (
    <Box component="span" sx={{ display: 'inline-block', width, height: 6, borderRadius: 1, background: t.meterTrack, verticalAlign: 'middle', overflow: 'hidden' }}>
      <Box component="span" sx={{ display: 'block', height: '100%', width: `${v}%`, background: color }} />
    </Box>
  );
}

/* --------------------------------------------------------------- notice */

const NOTICE_ICON: Record<StateTone, string> = {
  ok: 'mdi:check-circle-outline',
  warn: 'mdi:alert-outline',
  err: 'mdi:alert-octagon-outline',
  move: 'mdi:progress-clock',
  idle: 'mdi:information-outline',
};

/** An inline notice: what is going on, and what to do about it. */
export function Notice({
  tone = 'idle',
  title,
  children,
  action,
  icon,
  sx,
}: {
  tone?: StateTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  icon?: string;
  sx?: BoxProps['sx'];
}) {
  const t = useTokens();
  return (
    <Box
      role={tone === 'err' ? 'alert' : 'status'}
      sx={{
        display: 'flex',
        gap: 1.25,
        alignItems: 'flex-start',
        px: 1.75,
        py: 1.25,
        borderRadius: `${t.radius.panel}px`,
        background: t.tint[tone],
        borderLeft: `3px solid ${STATE[tone]}`,
        fontSize: 13.5,
        lineHeight: 1.5,
        ...sx,
      }}
    >
      <Icon icon={icon ?? NOTICE_ICON[tone]} width={18} style={{ color: stateText(tone, t.dark), flex: 'none', marginTop: 1 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {title && <Box sx={{ fontWeight: 600 }}>{title}</Box>}
        {children && <Box sx={{ color: t.text, '& p': { m: 0, mb: 0.5 } }}>{children}</Box>}
      </Box>
      {action && <Box sx={{ flex: 'none', alignSelf: 'center' }}>{action}</Box>}
    </Box>
  );
}

/* -------------------------------------------------------------- toolbar */

export function ToolButton({ icon, children, tooltip, ...rest }: ButtonProps & { icon?: string; tooltip?: string }) {
  const btn = (
    <Button
      size="small"
      variant="text"
      color="inherit"
      startIcon={icon ? <Icon icon={icon} width={18} /> : undefined}
      {...rest}
      sx={{ textTransform: 'none', fontWeight: 500, fontSize: 13.5, px: 1.25, whiteSpace: 'nowrap', ...(rest.sx as object) }}
    >
      {children}
    </Button>
  );
  return tooltip ? (
    <Tooltip title={tooltip}>
      <span>{btn}</span>
    </Tooltip>
  ) : (
    btn
  );
}

/** A primary or secondary action button with an optional reason when disabled. */
export function Action({
  icon,
  children,
  reason,
  disabled,
  ...rest
}: ButtonProps & { icon?: string; reason?: string | null }) {
  const off = disabled || !!reason;
  const btn = (
    <Button
      size="small"
      variant="outlined"
      startIcon={icon ? <Icon icon={icon} width={17} /> : undefined}
      disabled={off}
      {...rest}
      sx={{ textTransform: 'none', fontWeight: 550, whiteSpace: 'nowrap', ...(rest.sx as object) }}
    >
      {children}
    </Button>
  );
  return reason ? (
    <Tooltip title={reason}>
      <span>{btn}</span>
    </Tooltip>
  ) : (
    btn
  );
}

export function IconAction({
  icon,
  label,
  onClick,
  disabled,
  size = 18,
  color,
}: {
  icon: string;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  size?: number;
  color?: string;
}) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton size="small" aria-label={label} onClick={onClick} disabled={disabled} sx={{ color }}>
          <Icon icon={icon} width={size} />
        </IconButton>
      </span>
    </Tooltip>
  );
}

export function Toolbar({ children, sx }: { children: React.ReactNode; sx?: BoxProps['sx'] }) {
  const t = useTokens();
  return (
    <Box
      role="toolbar"
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, px: 1, minHeight: 44, borderBottom: `1px solid ${t.rule}`, ...sx }}
    >
      {children}
    </Box>
  );
}

export function Divider() {
  const t = useTokens();
  return <Box aria-hidden sx={{ width: '1px', alignSelf: 'stretch', my: 1, mx: 0.75, background: t.rule }} />;
}

/* ---------------------------------------------------------- empty state */

export function Empty({ icon, title, children, action }: { icon: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const t = useTokens();
  return (
    <Box sx={{ py: 5, px: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1 }}>
      <Icon icon={icon} width={34} style={{ color: t.muted, opacity: 0.8 }} />
      <Typography sx={{ fontWeight: 600, fontSize: 16 }}>{title}</Typography>
      {children && <Typography component="div" sx={{ color: t.muted, fontSize: 14, maxWidth: 560 }}>{children}</Typography>}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Box>
  );
}

/* ------------------------------------------------------------ sparkline */

export function Sparkline({
  values,
  max,
  width = 120,
  height = 28,
  color,
  label,
}: {
  values: number[];
  max?: number;
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}) {
  const t = useTokens();
  const stroke = color ?? t.meterUsed;
  if (values.length < 2)
    return <Box component="span" aria-label={label} sx={{ display: 'inline-block', width, height, borderBottom: `1px dashed ${t.rule}` }} />;
  const m = max ?? Math.max(...values, 1e-9);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / m) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} role="img" aria-label={label} style={{ display: 'block' }}>
      <polyline points={`0,${height} ${pts.join(' ')} ${width},${height}`} fill={`${stroke}22`} stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------- chips, identifiers */

export function Tag({ children, tone, title }: { children: React.ReactNode; tone?: StateTone | 'accent'; title?: string }) {
  const t = useTokens();
  const color = tone === 'accent' ? t.meterUsed : tone ? stateText(tone, t.dark) : t.muted;
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        height: 22,
        borderRadius: `${t.radius.small}px`,
        border: `1px solid ${tone && tone !== 'accent' ? `${STATE[tone]}66` : t.rule}`,
        background: tone && tone !== 'accent' ? t.tint[tone] : 'transparent',
        fontSize: 12.5,
        color,
        whiteSpace: 'nowrap',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </Box>
  );
}

/** A Ceph or Kubernetes identifier (osd.3, an image name, a config key). */
export function Mono({ children, muted, title }: { children: React.ReactNode; muted?: boolean; title?: string }) {
  const t = useTokens();
  return (
    <Box
      component="code"
      title={title}
      sx={{ fontFamily: t.font.mono, fontSize: '0.92em', color: muted ? t.muted : 'inherit', overflowWrap: 'anywhere' }}
    >
      {children}
    </Box>
  );
}

export function SectionTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
      <Typography component="h2" sx={{ fontSize: 17, fontWeight: 600, flex: 1 }}>
        {children}
      </Typography>
      {actions}
    </Box>
  );
}

/** A figure: value large, label small under it. */
export function Figure({
  value,
  label,
  tone,
  sub,
  onBand,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  tone?: StateTone;
  sub?: React.ReactNode;
  /** On a basalt Band: light text in both themes. */
  onBand?: boolean;
}) {
  const t = useTokens();
  const text = onBand ? t.basaltText : t.text;
  const muted = onBand ? t.basaltMuted : t.muted;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2, color: tone ? (onBand ? STATE[tone] : stateText(tone, t.dark)) : text, ...tabular }}
        noWrap
      >
        {value}
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: muted }} noWrap>
        {label}
      </Typography>
      {sub && <Typography sx={{ fontSize: 12, color: muted, ...tabular }}>{sub}</Typography>}
    </Box>
  );
}

/** Small "x ago" text with the full time in a tooltip. */
export function When({ at, prefix }: { at?: string | number | Date | null; prefix?: string }) {
  if (!at) return <>—</>;
  const d = at instanceof Date ? at : new Date(typeof at === 'number' && at < 1e12 ? at * 1000 : at);
  if (isNaN(d.getTime())) return <>—</>;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  const txt =
    s < 0 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
  return (
    <span title={d.toLocaleString()}>
      {prefix ? `${prefix} ` : ''}
      {txt}
    </span>
  );
}
