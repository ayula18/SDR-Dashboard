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

  async run({ mode, cursor, saveCursor, deadline }) {
    if (!heyreachConfigured()) return { status: 'skipped', reason: 'HEYREACH_API_KEY is not set' };

    const campaigns = await qp(`
      SELECT id, external_id, status_raw
        FROM dash_campaigns
       WHERE platform = 'heyreach' AND status_raw <> 'DRAFT'
       ORDER BY (status_raw = 'IN_PROGRESS') DESC, created_at_src DESC NULLS LAST`);
    // campaign id → the status it had when its people were last read
    const readAs = { ...(cursor?.statuses || {}) };
    const targets = campaigns.filter(c => mode === 'full' || c.status_raw === 'IN_PROGRESS' || readAs[c.id] !== c.status_raw);
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

    const save = () => saveCursor({ statuses: Object.fromEntries(campaigns.filter(c => readAs[c.id]).map(c => [c.id, readAs[c.id]])) });
    const stats = { campaigns: targets.length, synced: 0, people: 0, matched: 0 };

    for (const [i, campaign] of targets.entries()) {
      if (Date.now() > deadline) {
        await save();
        return { complete: false, ...stats };
      }

      const leads = await listHeyreachCampaignLeads(campaign.external_id);
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
      await withTx(async client => {
        await client.query(`DELETE FROM dash_linkedin_leads WHERE campaign_id = $1`, [campaign.id]);
        await upsertRows('dash_linkedin_leads', COLUMNS, rows, { conflict: ['campaign_id', 'lead_id'], client });
      });
      readAs[campaign.id] = campaign.status_raw;
      stats.synced++;
      stats.people += rows.length;
      if (i % 10 === 9) await save();
    }

    await save();
    return stats;
  },
};
