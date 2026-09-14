'use client';

import { createContext, useContext, useMemo } from 'react';
import { useApi } from './use-api';

const DashboardContext = createContext({ user: null, isAdmin: false, meta: null, reloadMeta: () => {} });

/** Who is signed in, plus the filter options and data warnings every page shares. */
export function DashboardProvider({ user, children }) {
  const { data: meta, reload } = useApi('/api/meta');
  const value = useMemo(
    () => ({ user, isAdmin: user?.role === 'admin', meta, reloadMeta: reload }),
    [user, meta, reload]
  );
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export const useDashboard = () => useContext(DashboardContext);

/** Team colour for an SDR name, from the roster. */
export function useTeamColor() {
  const { meta } = useDashboard();
  return useMemo(() => {
    const colors = new Map((meta?.team || []).map(t => [t.name, t.color]));
    return name => colors.get(name) || 'var(--viz-neutral)';
  }, [meta]);
}
