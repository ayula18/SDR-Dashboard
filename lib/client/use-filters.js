'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/** Filters every metrics endpoint understands. They live in the URL, so any view can be shared as a link. */
export const SHARED_FILTERS = ['range', 'from', 'to', 'grain', 'sdr', 'program', 'theme'];

export const RANGE_OPTIONS = [
  { value: 'this-week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'last-4-weeks', label: 'Last 4 weeks' },
  { value: 'last-12-weeks', label: 'Last 12 weeks' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3-months', label: 'Last 3 months' },
  { value: 'ytd', label: 'Year to date' },
];

export function useFilters({ defaultRange = 'last-4-weeks' } = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const values = useMemo(() => {
    const v = Object.fromEntries(SHARED_FILTERS.map(key => [key, searchParams.get(key) || '']));
    if (!v.range && !v.from) v.range = defaultRange;
    return v;
  }, [searchParams, defaultRange]);

  const apiParams = useMemo(
    () => Object.fromEntries(Object.entries(values).filter(([, v]) => v)),
    [values]
  );

  /** Merge updates into the URL; empty values remove the param. */
  const setParams = useCallback(updates => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  const get = useCallback(key => searchParams.get(key) || '', [searchParams]);

  return { values, apiParams, setParams, get };
}

/** Builds links that carry the current date range and grain (and optionally the other filters) to another page. */
export function useLinkWithFilters() {
  const searchParams = useSearchParams();
  return useCallback((path, { keep = ['range', 'from', 'to', 'grain'], extra = {} } = {}) => {
    const qs = new URLSearchParams();
    for (const key of keep) {
      const value = searchParams.get(key);
      if (value) qs.set(key, value);
    }
    for (const [key, value] of Object.entries(extra)) if (value) qs.set(key, value);
    const query = qs.toString();
    return query ? `${path}?${query}` : path;
  }, [searchParams]);
}
