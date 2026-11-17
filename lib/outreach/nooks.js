/**
 * Nooks, the cold-calling dialer, read-only (Ayush, 2026-11-17). The workspace has the
 * Dialer product only: /dialer/calls and /users answer; Sequencing, Conversation
 * Intelligence and Enrichment endpoints answer 403.
 *
 * The API key has full read AND write on the workspace (POST /calls would even log a call
 * to the CRM, which cannot be switched off), so this module only ever sends GET: the
 * method is fixed below and tests/nooks.test.mjs fails on any other verb here.
 *
 * Lists are cursor pages of 100, in id order rather than time order, so every read is
 * bounded by call time. 300 requests a minute per list endpoint; this stays near 240.
 */
const BASE = 'https://partner-api.nooks.in';
const PAGE = 100;
const BETWEEN_CALLS_MS = 250;

export const nooksConfigured = () => Boolean(process.env.NOOKS_API_KEY);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One GET, retried on 429 as Nooks asks (Retry-After). `path` starts with /v1. */
async function get(path) {
  const key = process.env.NOOKS_API_KEY;
  if (!key) throw Object.assign(new Error('NOOKS_API_KEY is not set'), { code: 'not_configured' });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (res.status === 429 && attempt <= 4) {
      await wait(1000 * Number(res.headers.get('retry-after') || 5 * attempt));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Nooks ${path.split('?')[0]}: ${res.status} ${body?.error?.details?.message || body?.error?.message || ''}`.trim());
    await wait(BETWEEN_CALLS_MS);
    return body;
  }
}

async function* pages(path) {
  for (let next = path; next; ) {
    const body = await get(next);
    yield body.data || [];
    next = body.links?.next || null;
  }
}

/** Everyone with a Nooks login, as { id, name, email }. A user deleted in Nooks is no longer here. */
export async function nooksUsers() {
  const users = [];
  for await (const page of pages(`/v1/users?page%5Bsize%5D=${PAGE}`)) users.push(...page);
  return users.map(u => ({ id: u.id, name: u.name || null, email: u.email || null }));
}

/** Every call dialed from `from` (inclusive) to `toExclusive`, both Dates. */
export async function dialerCalls({ from, toExclusive }) {
  const q = new URLSearchParams({
    'page[size]': String(PAGE),
    'filter[time][gte]': from.toISOString(),
    'filter[time][lt]': toExclusive.toISOString(),
  });
  const calls = [];
  for await (const page of pages(`/v1/dialer/calls?${q}`)) calls.push(...page);
  return calls;
}

export const CALL_COLUMNS = [
  'id', 'called_at', 'owner_id', 'owner_email', 'owner_name', 'direction', 'dialing_mode', 'duration_s',
  'call_label', 'disposition', 'call_outcome', 'prospect_name', 'prospect_email', 'prospect_source',
  'has_recording', 'has_transcript', 'updated_at_src', 'synced_at',
];

/**
 * A Nooks call as a dash_calls row, in CALL_COLUMNS order. Metadata only: the recording
 * and transcript are kept as yes or no, and phone numbers are not kept. `users` maps a
 * Nooks user id to { name, email }; a deleted user's calls keep only the id.
 */
export function callRow(call, users, syncedAt = new Date()) {
  const owner = users.get(call.owner?.id) || null;
  const disposition = call.callDisposition || null;
  return [
    call.id,
    call.time,
    call.owner?.id || null,
    owner?.email ? owner.email.toLowerCase() : null,
    owner?.name || null,
    call.direction || null,
    call.dialingMode || null,
    Math.max(0, Math.round(Number(call.duration) || 0)),
    call.callLabel || null,
    disposition?.name?.trim() || null,
    disposition?.callOutcome || null,
    call.prospect?.name?.trim() || null,
    call.prospect?.email ? call.prospect.email.toLowerCase() : null,
    call.prospect?.source || null,
    Boolean(call.recordingUrl),
    Boolean(call.transcript),
    call.updatedAt || null,
    syncedAt,
  ];
}
