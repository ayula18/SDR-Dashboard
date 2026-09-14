import { qp, upsertRows } from '../../db.js';
import { instantlyConfigured, listLeadsPage } from '../../outreach/instantly.js';
import { domainFromEmail, normalizeDomain } from '../../outreach/domains.js';

const COLUMNS = [
  'id', 'campaign_id', 'email', 'company_domain', 'company_name', 'status', 'interest_status', 'reply_count',
  'replied_step', 'replied_variant', 'upload_method', 'last_step_id', 'last_sender', 'created_at_src',
  'last_contact_at', 'last_reply_at', 'interest_changed_at', 'synced_at',
];

const intOrNull = v => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const ts = v => (v ? new Date(v) : null);

function toRow(lead, syncedAt) {
  const email = String(lead.email ?? '').trim().toLowerCase() || null;
  let summary = lead.status_summary;
  if (typeof summary === 'string') {
    try { summary = JSON.parse(summary); } catch { summary = null; }
  }
  return [
    String(lead.id), lead.campaign ? `instantly:${lead.campaign}` : null, email,
    normalizeDomain(lead.company_domain) || domainFromEmail(email), lead.company_name || null,
    intOrNull(lead.status), intOrNull(lead.lt_interest_status), intOrNull(lead.email_reply_count) ?? 0,
    intOrNull(lead.email_replied_step), intOrNull(lead.email_replied_variant), lead.upload_method || null,
    summary?.lastStep?.stepID || null, summary?.lastStep?.from || null,
    ts(lead.timestamp_created), ts(lead.timestamp_last_contact), ts(lead.timestamp_last_reply),
    ts(lead.timestamp_last_interest_change), syncedAt,
  ];
}

async function savePage(items) {
  const syncedAt = new Date();
  return upsertRows('dash_leads', COLUMNS, items.map(l => toRow(l, syncedAt)), { conflict: ['id'] });
}

/**
 * Every lead loaded into Instantly: the allocation record (who was loaded
 * into which campaign when), plus contact, reply and interest status.
 */
export const job = {
  label: 'Instantly leads',

  async run({ mode, cursor: saved, saveCursor, deadline, log }) {
    if (!instantlyConfigured()) return { status: 'skipped', reason: 'INSTANTLY_API_KEY is not set' };

    if (mode === 'full') {
      // ~32K leads, ~320 pages. Resumable across timeouts; `startedAt` lets the
      // final page remove leads that were deleted in Instantly.
      const startedAt = saved?.startedAt || new Date().toISOString();
      let cursor = saved?.cursor || null;
      let pages = 0;
      let leads = 0;
      do {
        const page = await listLeadsPage({ cursor });
        leads += await savePage(page.items);
        cursor = page.next;
        pages++;
        if (pages % 50 === 0) log(`${pages} pages, ${leads} leads`);
        if (cursor) {
          await saveCursor({ cursor, startedAt });
          if (Date.now() > deadline) return { complete: false, pages, leads };
        }
      } while (cursor);

      const [{ removed }] = await qp(
        `WITH d AS (DELETE FROM dash_leads WHERE synced_at < $1 RETURNING 1) SELECT count(*)::int AS removed FROM d`,
        [startedAt]
      );
      await saveCursor(null);
      return { pages, leads, removed };
    }

    // Incremental: campaigns created recently or active in the last three weeks.
    const campaigns = await qp(`
      SELECT c.external_id
        FROM dash_campaigns c
       WHERE c.platform = 'instantly' AND c.status <> 'deleted'
         AND (c.created_at_src >= NOW() - INTERVAL '21 days'
              OR EXISTS (SELECT 1 FROM dash_campaign_periods p
                          WHERE p.campaign_id = c.id AND p.grain = 'week' AND p.period_start >= CURRENT_DATE - 21))
       ORDER BY c.id`);

    // Resumable: a run cut short by the time budget continues with the next campaign.
    const startAt = saved?.mode === 'incremental' && saved.index < campaigns.length ? saved.index : 0;
    let leads = 0;
    for (let i = startAt; i < campaigns.length; i++) {
      let cursor = null;
      do {
        const page = await listLeadsPage({ campaignId: campaigns[i].external_id, cursor });
        leads += await savePage(page.items);
        cursor = page.next;
      } while (cursor);
      if (Date.now() > deadline && i + 1 < campaigns.length) {
        await saveCursor({ mode: 'incremental', index: i + 1 });
        return { complete: false, campaigns: i + 1 - startAt, resumeAt: i + 1, leads };
      }
    }
    if (startAt) await saveCursor(null);
    return { campaigns: campaigns.length - startAt, leads };
  },
};
