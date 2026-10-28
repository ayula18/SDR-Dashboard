/**
 * Instantly API v2, read-only: campaigns, campaign analytics and leads.
 *
 * Reply content is deliberately not pulled here. The AI SDR app's Instantly
 * sync archives every email in ctx_events and this app reads replies from
 * there, so the two apps never spend Instantly's 20-requests-a-minute /emails
 * allowance twice. A job whose key lacks a scope reports itself as blocked
 * instead of failing silently.
 *
 * TWO WORKSPACES, ONE API. The account has a second Instantly workspace that
 * everything the AI SDR agent sends goes out from, and a workspace is reachable
 * only with its own key. Every function here therefore takes a workspace id,
 * and every caller loops `configuredWorkspaces()` instead of calling once.
 *
 * This file used to read INSTANTLY_API_KEY directly, which silently made the
 * whole app mean "the original workspace" — 43 campaigns, 811 sent emails and
 * 14 opportunities were missing from every funnel, and no job reported an
 * error, because the key it had worked perfectly for the half it could see.
 */

const API_BASE = 'https://api.instantly.ai/api/v2';
const MIN_GAP_MS = 250;
const REQUEST_TIMEOUT_MS = 30_000; // fetch has no default timeout; a stalled connection would hang the sync

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCallAt = 0;

export class InstantlyError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Every Instantly workspace this app can read, in the order a funnel should
 * total them. `source` is the matching ctx_events.source the AI SDR app's
 * archive writes, so the two apps name the same workspace the same way.
 */
export const WORKSPACES = [
  { id: 'instantly', label: 'Instantly.ai', envVar: 'INSTANTLY_API_KEY', source: 'instantly' },
  { id: 'instantly_aisdr', label: 'Instantly.ai (AI SDR)', envVar: 'INSTANTLY_SEND_API_KEY', source: 'instantly_aisdr' },
];

/** The workspaces whose key is actually present. A missing second key is not an error. */
export const configuredWorkspaces = () => WORKSPACES.filter(w => process.env[w.envVar]);

export const instantlyConfigured = () => configuredWorkspaces().length > 0;

export const workspaceLabel = id => WORKSPACES.find(w => w.id === id)?.label || id;

function keyFor(workspaceId) {
  const workspace = WORKSPACES.find(w => w.id === workspaceId);
  if (!workspace) {
    throw new InstantlyError(`Unknown Instantly workspace '${workspaceId}'`, { code: 'unknown_workspace' });
  }
  const key = process.env[workspace.envVar];
  if (!key) throw new InstantlyError(`${workspace.envVar} is not set`, { code: 'not_configured' });
  return key;
}

async function request(path, { method = 'GET', query, body, workspace = 'instantly' } = {}) {
  const key = keyFor(workspace);

  const params = query
    ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    : null;
  const url = `${API_BASE}${path}${params && [...params].length ? `?${params}` : ''}`;

  for (let attempt = 0; ; attempt++) {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
    } catch (err) {
      // Network failure or timeout (reset, DNS, TLS, stalled body): retry like a 5xx.
      const reason = err.cause?.code || err.name || err.message;
      if (attempt < 5) {
        console.warn(`[instantly:${workspace}] ${method} ${path} failed (${reason}); retry ${attempt + 1}`);
        await sleep(Math.min(60_000, 2000 * 2 ** attempt));
        continue;
      }
      throw new InstantlyError(`Instantly ${method} ${path} [${workspace}] failed: ${reason}`);
    }

    const text = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const retryAfter = Number(res.headers.get('retry-after'));
      console.warn(`[instantly:${workspace}] ${method} ${path} returned ${res.status}; retry ${attempt + 1}`);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 2000 * 2 ** attempt));
      continue;
    }
    if (res.status === 401 && /scope/i.test(text)) {
      const needed = text.match(/Required:\s*([\w:]+)/)?.[1] || 'a missing scope';
      throw new InstantlyError(
        `Instantly key for ${workspaceLabel(workspace)} lacks ${needed}. Re-issue the key with that scope.`,
        { status: 401, code: 'missing_scope' }
      );
    }
    throw new InstantlyError(
      `Instantly ${method} ${path} [${workspace}] returned ${res.status}: ${text.slice(0, 200)}`,
      { status: res.status }
    );
  }
}

export async function listCampaigns({ workspace = 'instantly' } = {}) {
  const all = [];
  let cursor = null;
  do {
    const data = await request('/campaigns', { query: { limit: 100, starting_after: cursor }, workspace });
    const items = data.items || [];
    all.push(...items);
    cursor = items.length ? data.next_starting_after : null;
  } while (cursor);
  return all;
}

/** Per-campaign analytics; lifetime without dates, or for [startDate, endDate] (inclusive, YYYY-MM-DD). */
export async function campaignAnalytics({ startDate, endDate, workspace = 'instantly' } = {}) {
  const rows = await request('/campaigns/analytics', {
    query: { start_date: startDate, end_date: endDate },
    workspace,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function campaignStepAnalytics(campaignId, { startDate, endDate, workspace = 'instantly' } = {}) {
  const rows = await request('/campaigns/analytics/steps', {
    query: { campaign_id: campaignId, start_date: startDate, end_date: endDate },
    workspace,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function listLeadsPage({ campaignId, cursor, limit = 100, workspace = 'instantly' } = {}) {
  const data = await request('/leads/list', {
    method: 'POST',
    body: { limit, ...(campaignId ? { campaign: campaignId } : {}), ...(cursor ? { starting_after: cursor } : {}) },
    workspace,
  });
  const items = data.items || [];
  return { items, next: items.length ? data.next_starting_after || null : null };
}
