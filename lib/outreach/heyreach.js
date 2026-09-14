/**
 * HeyReach public API, read-only. Header is X-API-KEY, 300 requests/minute.
 *
 * Checked against the live workspace on 2026-09-11: campaigns and sender
 * accounts page with { offset, limit } and return { totalCount, items };
 * stats/GetOverallStats returns overallStats plus byDayStats keyed by ISO
 * datetime ("2026-08-01T00:00:00Z"). Campaign status is IN_PROGRESS, PAUSED,
 * FINISHED, FAILED, CANCELED or DRAFT. campaign/GetLeadsFromCampaign pages the
 * same way; each item carries linkedInUserProfile (companyName, position,
 * linkedin_id), leadConnectionStatus, leadMessageStatus and the sender.
 */

const API_BASE = 'https://api.heyreach.io/api/public';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const heyreachConfigured = () => Boolean(process.env.HEYREACH_API_KEY);

// At most ~100 requests a minute, a third of the API key's limit. Every call in this
// file reads data HeyReach already holds; none makes a sender account act on LinkedIn.
const MIN_GAP_MS = 600;
let nextSlotAt = 0;

async function waitForSlot() {
  const now = Date.now();
  const wait = nextSlotAt - now;
  nextSlotAt = Math.max(now, nextSlotAt) + MIN_GAP_MS;
  if (wait > 0) await sleep(wait);
}

async function post(path, body = {}) {
  const key = process.env.HEYREACH_API_KEY;
  if (!key) throw Object.assign(new Error('HEYREACH_API_KEY is not set'), { code: 'not_configured' });

  for (let attempt = 0; ; attempt++) {
    await waitForSlot();
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000), // fetch has no default timeout
      });
      if (res.ok) return await res.json();
    } catch (err) {
      if (attempt < 4) {
        await sleep(1500 * 2 ** attempt);
        continue;
      }
      throw new Error(`HeyReach ${path} failed: ${err.cause?.code || err.name || err.message}`);
    }

    const text = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    throw new Error(`HeyReach ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function listAll(path, body = {}) {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const data = await post(path, { ...body, offset, limit: 100 });
    const items = data?.items || [];
    all.push(...items);
    if (items.length < 100 || (data?.totalCount != null && all.length >= data.totalCount)) return all;
  }
}

export const listHeyreachCampaigns = () => listAll('/campaign/GetAll');
export const listHeyreachAccounts = () => listAll('/li_account/GetAll');
export const listHeyreachCampaignLeads = campaignId => listAll('/campaign/GetLeadsFromCampaign', { campaignId: Number(campaignId) });

const num = (o, ...keys) => {
  for (const k of keys) if (o?.[k] != null) return Number(o[k]) || 0;
  return 0;
};

/**
 * One stats object → our column names.
 *
 * Messages are conversations started (totalMessageStarted): HeyReach's own
 * messageReplyRate is totalMessageReplies ÷ totalMessageStarted, while
 * messagesSent counted only 17 messages across the whole workspace in 2026.
 */
export function toLinkedinStats(s) {
  return {
    connections_sent: num(s, 'connectionsSent'),
    connections_accepted: num(s, 'connectionsAccepted'),
    messages_sent: num(s, 'totalMessageStarted'),
    message_replies: num(s, 'totalMessageReplies'),
    inmails_sent: num(s, 'totalInmailStarted'),
    inmail_replies: num(s, 'totalInmailReplies'),
  };
}

/** Overall + per-day stats for one campaign over [startDate, endDate]. */
export async function heyreachCampaignStats(campaignId, { startDate, endDate }) {
  const data = await post('/stats/GetOverallStats', {
    accountIds: [],
    campaignIds: [campaignId],
    startDate: `${startDate}T00:00:00.000Z`,
    endDate: `${endDate}T23:59:59.999Z`,
  });

  // byDayStats has been seen both as { "<date>": {...} } and as [{ date, ... }].
  const raw = data?.byDayStats || {};
  const days = Array.isArray(raw)
    ? raw.map(d => ({ date: String(d.date || d.day || '').slice(0, 10), stats: toLinkedinStats(d) }))
    : Object.entries(raw).map(([date, d]) => ({ date: date.slice(0, 10), stats: toLinkedinStats(d) }));

  return { overall: toLinkedinStats(data?.overallStats || {}), days: days.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date)) };
}
