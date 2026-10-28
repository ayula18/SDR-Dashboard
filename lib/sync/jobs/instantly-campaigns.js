import { qp, upsertRows } from '../../db.js';
import { campaignAnalytics, configuredWorkspaces, instantlyConfigured, listCampaigns } from '../../outreach/instantly.js';
import { stripHtml } from '../../outreach/text.js';
import { loadCampaignParser } from '../parse.js';

const STATUS = { 0: 'draft', 1: 'active', 2: 'paused', 3: 'completed' };
const int = v => Number.parseInt(v, 10) || 0;

const CAMPAIGN_COLUMNS = [
  'id', 'platform', 'workspace', 'external_id', 'name', 'status', 'status_raw', 'created_at_src', 'updated_at_src',
  'parsed_sdr', 'parsed_program', 'parsed_theme', 'parsed_segment', 'parsed_region', 'sequence', 'synced_at',
];
const STAT_COLUMNS = [
  'campaign_id', 'leads', 'sent', 'contacted', 'new_leads_contacted', 'replies_unique', 'auto_replies_unique',
  'bounced', 'unsubscribed', 'completed', 'opportunities', 'opportunity_value', 'synced_at',
];

/** The copy of each step and A/B variant, trimmed: enough to see what was sent. */
function sequenceSummary(sequences) {
  return (sequences?.[0]?.steps || []).slice(0, 10).map((s, i) => ({
    step: i,
    delay: s.delay ?? null,
    variants: (s.variants || []).slice(0, 8).map(v => ({ subject: v.subject || '', preview: stripHtml(v.body).slice(0, 400) })),
  }));
}

export const job = {
  label: 'Instantly campaigns and lifetime totals',
  weight: 1,
  minSliceMs: 20_000,
  maxAgeHours: 36,

  async run({ log }) {
    if (!instantlyConfigured()) return { status: 'skipped', reason: 'no Instantly API key is set' };

    const parse = await loadCampaignParser();
    const totals = { campaigns: 0, withStats: 0, withoutSdr: 0, deleted: 0 };
    const byWorkspace = {};
    const failed = [];

    // One workspace at a time, each with its own key. A key that fails must not
    // cost the other workspace its data, and must not let this job's deleted
    // sweep mark that workspace's campaigns deleted for not being re-synced.
    for (const w of configuredWorkspaces()) {
      try {
        const syncedAt = new Date();
        const campaigns = await listCampaigns({ workspace: w.id });

        const rows = campaigns.map(c => {
          const p = parse(c.name);
          return [
            `instantly:${c.id}`, 'instantly', w.id, String(c.id), c.name || '(unnamed)', STATUS[c.status] || 'other', String(c.status),
            c.timestamp_created || null, c.timestamp_updated || null,
            p.sdr, p.program, p.theme, p.segment, p.region, JSON.stringify(sequenceSummary(c.sequences)), syncedAt,
          ];
        });
        await upsertRows('dash_campaigns', CAMPAIGN_COLUMNS, rows, { conflict: ['id'] });

        // Campaigns deleted in Instantly keep their history here but stop counting as live.
        const deleted = await qp(
          `UPDATE dash_campaigns SET status = 'deleted'
            WHERE platform = 'instantly' AND workspace = $2 AND synced_at < $1 AND status <> 'deleted' RETURNING id`,
          [syncedAt, w.id]
        );

        const known = new Set(rows.map(r => r[0]));
        const stats = (await campaignAnalytics({ workspace: w.id }))
          .filter(a => known.has(`instantly:${a.campaign_id}`))
          .map(a => [
            `instantly:${a.campaign_id}`, int(a.leads_count), int(a.emails_sent_count), int(a.contacted_count),
            int(a.new_leads_contacted_count), int(a.reply_count_unique), int(a.reply_count_automatic_unique),
            int(a.bounced_count), int(a.unsubscribed_count), int(a.completed_count), int(a.total_opportunities),
            Number(a.total_opportunity_value) || 0, syncedAt,
          ]);
        await upsertRows('dash_campaign_stats', STAT_COLUMNS, stats, { conflict: ['campaign_id'] });

        log(`${w.label}: ${rows.length} campaigns, ${stats.length} with stats, ${deleted.length} newly marked deleted`);
        byWorkspace[w.id] = { campaigns: rows.length, withStats: stats.length, deleted: deleted.length };
        totals.campaigns += rows.length;
        totals.withStats += stats.length;
        totals.withoutSdr += rows.filter(r => !r[9]).length;
        totals.deleted += deleted.length;
      } catch (err) {
        log(`${w.label}: ${err.message}`);
        failed.push({ workspace: w.id, error: String(err.message || err).slice(0, 200) });
      }
    }

    // Every workspace failing is the job failing; the first error says why.
    if (failed.length && failed.length === configuredWorkspaces().length) {
      const err = new Error(failed.map(f => `${f.workspace}: ${f.error}`).join('; '));
      throw err;
    }
    return { ...totals, byWorkspace, ...(failed.length ? { complete: false, failed } : {}) };
  },
};
