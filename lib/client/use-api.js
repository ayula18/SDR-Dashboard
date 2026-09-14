'use client';

import { useCallback, useEffect, useState } from 'react';

// Last response per URL for this browser session. Navigating back to a page, or
// flipping a filter back, shows the numbers instantly while they refresh.
const cache = new Map();

export function buildUrl(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

/** fetch() for the dashboard API: JSON in and out, errors thrown with the server's message, 401 → login. */
export async function apiFetch(url, { method = 'GET', body, headers, signal } = {}) {
  const res = await fetch(url, {
    method,
    signal,
    headers: body && typeof body !== 'string' ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body && typeof body !== 'string' ? JSON.stringify(body) : body,
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    const next = window.location.pathname + window.location.search;
    // A full page load on purpose: it drops every cached response along with the dead session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
    throw new Error('Your session ended. Sign in again.');
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(payload.error || `Request failed with ${res.status}`), { status: res.status });
  return payload;
}

export function clearApiCache() {
  cache.clear();
}

/**
 * GET a dashboard endpoint. While a new request is in flight the previous
 * numbers stay on screen (`refreshing`), so filtering never flashes a skeleton.
 */
export function useApi(path, params, { enabled = true } = {}) {
  const url = enabled && path ? buildUrl(path, params) : null;
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState({ key: null, data: null, error: null });
  const key = url ? `${url}#${nonce}` : null;

  useEffect(() => {
    if (!url) return undefined;
    const requestKey = `${url}#${nonce}`;
    const controller = new AbortController();
    apiFetch(url, { signal: controller.signal })
      .then(data => {
        cache.set(url, data);
        setResult({ key: requestKey, data, error: null });
      })
      .catch(error => {
        if (error.name === 'AbortError') return;
        setResult(prev => ({ key: requestKey, data: prev.data, error }));
      });
    return () => controller.abort();
  }, [url, nonce]);

  const reload = useCallback(() => {
    if (url) cache.delete(url);
    setNonce(n => n + 1);
  }, [url]);

  const settled = key !== null && result.key === key;
  const data = settled ? result.data : (url && cache.get(url)) || result.data;

  return {
    data,
    error: settled ? result.error : null,
    loading: key !== null && !settled && !data,
    refreshing: key !== null && !settled && Boolean(data),
    reload,
  };
}
