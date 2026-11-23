/*
 * Per-browser preferences: which CephCluster (when there are several),
 * where Ceph commands run (toolbox or operator), how often the live view
 * refreshes. Kept in localStorage.
 */

import React from 'react';

export interface Settings {
  /** "namespace/name" of the CephCluster to show; empty = the first one. */
  cluster: string;
  /** Where to run Ceph commands. */
  bridge: 'auto' | 'toolbox' | 'operator';
  /** Live refresh period in seconds. */
  refreshSec: number;
}

const DEFAULTS: Settings = { cluster: '', bridge: 'auto', refreshSec: 10 };
const KEY = 'cairn.settings';

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const Ctx = React.createContext<[Settings, (p: Partial<Settings>) => void]>([DEFAULTS, () => undefined]);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = React.useState<Settings>(load);
  const update = React.useCallback((p: Partial<Settings>) => {
    setS(prev => {
      const next = { ...prev, ...p };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep in memory */
      }
      return next;
    });
  }, []);
  const value = React.useMemo(() => [s, update] as [Settings, (p: Partial<Settings>) => void], [s, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  return React.useContext(Ctx);
}
