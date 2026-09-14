import { qp, upsertRows } from '../../db.js';
import { campaignAnalytics, instantlyConfigured, listCampaigns } from '../../outreach/instantly.js';
import { stripHtml } from '../../outreach/text.js';
import { loadCampaignParser } from '../parse.js';

const STATUS = { 0: 'draft', 1: 'active', 2: 'paused', 3: 'completed' };
const int = v => Number.parseInt(v, 10) || 0;

const CAMPAIGN_COLUMNS = [
  'id', 'platform', 'external_id', 'name', 'status', 'status_raw', 'created_at_src', 'updated_at_src',
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

  async run({ log }) {
    if (!instantlyConfigured()) return { status: 'skipped', reason: 'INSTANTLY_API_KEY is not set' };

    const parse = await loadCampaignParser();
    const syncedAt = new Date();
    const campaigns = await listCampaigns();

    const rows = campaigns.map(c => {
      const p = parse(c.name);
      return [
        `instantly:${c.id}`, 'instantly', String(c.id), c.name || '(unnamed)', STATUS[c.status] || 'other', String(c.status),
        c.timestamp_created || null, c.timestamp_updated || null,
        p.sdr, p.program, p.theme, p.segment, p.region, JSON.stringify(sequenceSummary(c.sequences)), syncedAt,
      ];
    });
    await upsertRows('dash_campaigns', CAMPAIGN_COLUMNS, rows, { conflict: ['id'] });

    // Campaigns deleted in Instantly keep their history here but stop counting as live.
    const deleted = await qp(
      `UPDATE dash_campaigns SET status = 'deleted' WHERE platform = 'instantly' AND synced_at < $1 AND status <> 'deleted' RETURNING id`,
      [syncedAt]
    );
    log(`${rows.length} campaigns, ${deleted.length} newly marked deleted`);

    const known = new Set(rows.map(r => r[0]));
    const stats = (await campaignAnalytics())
      .filter(a => known.has(`instantly:${a.campaign_id}`))
      .map(a => [
        `instantly:${a.campaign_id}`, int(a.leads_count), int(a.emails_sent_count), int(a.contacted_count),
        int(a.new_leads_contacted_count), int(a.reply_count_unique), int(a.reply_count_automatic_unique),
        int(a.bounced_count), int(a.unsubscribed_count), int(a.completed_count), int(a.total_opportunities),
        Number(a.total_opportunity_value) || 0, syncedAt,
      ]);
    await upsertRows('dash_campaign_stats', STAT_COLUMNS, stats, { conflict: ['campaign_id'] });

    return { campaigns: rows.length, withStats: stats.length, withoutSdr: rows.filter(r => !r[8]).length, deleted: deleted.length };
  },
};
