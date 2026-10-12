import { qp, upsertRows, withTx } from '../../db.js';
import { normalizeDomain } from '../../outreach/domains.js';
import { heyreachConfigured, listHeyreachCampaignLeads } from '../../outreach/heyreach.js';
import { companyKey, nameIndex, resolveCompany } from '../../outreach/linkedin.js';

const COLUMNS = [
  'campaign_id', 'lead_id', 'linkedin_id', 'person_name', 'position', 'company_name', 'company_key', 'company_domain',
  'resolution', 'domain_candidates', 'sender', 'campaign_status', 'connection_status', 'message_status', 'error_code',
  'added_at', 'last_action_at', 'synced_at',
];
const clip = (value, max) => String(value ?? '').trim().slice(0, max) || null;

/**
 * Everyone in each HeyReach campaign: their company resolved to a domain
 * (lib/outreach/linkedin.js), title, sender, and how far the sequence got.
 *
 * A campaign is read once, then again only while it is running or when its
 * status changes (paused, finished, resumed), so a normal day reads just the
 * running campaigns. A full sync reads them all. Runs after the heyreach job,
 * which writes each campaign's current status.
 */
export const job = {
  label: 'HeyReach people and their companies',
  dependsOn: ['heyreach'],
  weight: 2,
  minSliceMs: 30_000,
  maxAgeHours: 72,

  async run({ mode, deadline }) {
    if (!heyreachConfigured()) return { status: 'skipped', reason: 'HEYREACH_API_KEY is not set' };

    // Least recently read first, so rotation is a property of the ordering
    // rather than something the job has to remember.
    //
    // The previous version kept the read statuses in a saved cursor, but then
    // re-included every IN_PROGRESS campaign regardless of that cursor and sorted
    // them first — so the same handful consumed every run and the backlog behind
    // them was never reached. The watermark cannot be outvoted that way: a
    // campaign read today sorts last tomorrow.
    //
    // A running campaign is still refreshed on a timer, and any campaign whose
    // status changed since its last read is picked up immediately.
    const targets = await qp(`
      SELECT id, external_id, status_raw
        FROM dash_campaigns
       WHERE platform = 'heyreach' AND status_raw <> 'DRAFT'
         AND ($1::boolean
              OR leads_read_at IS NULL
              OR leads_read_status IS DISTINCT FROM status_raw
              OR (status_raw = 'IN_PROGRESS' AND leads_read_at < NOW() - INTERVAL '20 hours'))
       ORDER BY leads_read_at NULLS FIRST, created_at_src DESC NULLS LAST`,
      [mode === 'full']);
    if (!targets.length) return { campaigns: 0, people: 0 };

    const [companies, emailed, archived] = await Promise.all([
      qp(`SELECT domain, company_name FROM companies WHERE domain IS NOT NULL AND company_name IS NOT NULL AND merged_into_id IS NULL`),
      qp(`SELECT company_domain AS domain, count(*)::int AS leads FROM dash_leads WHERE company_domain IS NOT NULL GROUP BY 1`),
      qp(`SELECT raw->'profile'->>'linkedinId' AS linkedin_id,
                 (array_agg(domain ORDER BY occurred_at DESC) FILTER (WHERE resolution_status = 'resolved' AND domain IS NOT NULL))[1] AS domain
            FROM ctx_events
           WHERE source = 'heyreach' AND raw->'profile'->>'linkedinId' IS NOT NULL
           GROUP BY 1`),
    ]);
    const lookups = {
      byName: nameIndex(companies),
      emailed: new Map(emailed.map(r => [r.domain, r.leads])),
      archive: new Map(archived.map(r => [r.linkedin_id, normalizeDomain(r.domain)]).filter(([, domain]) => domain)),
    };

    const stats = { campaigns: targets.length, synced: 0, people: 0, matched: 0 };

    for (const campaign of targets) {
      if (Date.now() > deadline) return { complete: false, ...stats };

      // A campaign's people are replaced wholesale below, so a partial read must
      // never be written: deleting 5,000 rows and inserting back the 2,000 that
      // arrived before the deadline would silently destroy the other 3,000.
      // Leave the watermark untouched and the campaign stays first in line.
      const { items: leads, complete } = await listHeyreachCampaignLeads(campaign.external_id, { deadlineAt: deadline });
      if (!complete) return { complete: false, ...stats, truncatedAt: campaign.external_id };
      const syncedAt = new Date();
      const rows = leads.map(lead => {
        const p = lead.linkedInUserProfile || {};
        const { domain, resolution, candidates } = resolveCompany({ companyName: p.companyName, linkedinId: p.linkedin_id }, lookups);
        if (domain) stats.matched++;
        return [
          campaign.id, String(lead.id), p.linkedin_id ? String(p.linkedin_id) : null,
          clip([p.firstName, p.lastName].filter(Boolean).join(' '), 120), clip(p.position, 200), clip(p.companyName, 200),
          companyKey(p.companyName), domain, resolution, candidates, clip(lead.linkedInSenderFullName, 120),
          lead.leadCampaignStatus || null, lead.leadConnectionStatus || null, lead.leadMessageStatus || null, lead.errorCode || null,
          lead.creationTime || null, lead.lastActionTime || null, syncedAt,
        ];
      });

      // Replaced wholesale, so someone removed from the campaign in HeyReach disappears here too.
      // The watermark is stamped in the same transaction, so it can never claim
      // a read that did not land.
      await withTx(async client => {
        await client.query(`DELETE FROM dash_linkedin_leads WHERE campaign_id = $1`, [campaign.id]);
        await upsertRows('dash_linkedin_leads', COLUMNS, rows, { conflict: ['campaign_id', 'lead_id'], client });
        await client.query(
          `UPDATE dash_campaigns SET leads_read_at = NOW(), leads_read_status = $2 WHERE id = $1`,
          [campaign.id, campaign.status_raw]
        );
      });
      stats.synced++;
      stats.people += rows.length;
    }

    return stats;
  },
};
