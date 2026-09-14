import { qp, upsertRows, withTx } from '../../db.js';
import { campaignStepAnalytics, instantlyConfigured } from '../../outreach/instantly.js';
import { addDays, isoDay, today } from '../../outreach/dates.js';

const COLUMNS = [
  'campaign_id', 'step', 'variant', 'subject', 'body_preview', 'sent', 'replies_unique',
  'auto_replies_unique', 'opportunities', 'synced_at',
];
const int = v => Number.parseInt(v, 10) || 0;

/**
 * Sent and replies per sequence step and A/B variant, joined to the copy.
 * One request per campaign, so only campaigns with recent activity are
 * refreshed (all 2026 campaigns in full mode, resumable).
 */
export const job = {
  label: 'Instantly step and variant performance',

  async run({ mode, cursor: saved, saveCursor, deadline }) {
    if (!instantlyConfigured()) return { status: 'skipped', reason: 'INSTANTLY_API_KEY is not set' };

    const since = mode === 'full' ? (process.env.DASH_START_DATE || '2026-01-05') : isoDay(addDays(today(), -28));
    const campaigns = await qp(
      `SELECT c.id, c.external_id, c.sequence
         FROM dash_campaigns c
        WHERE c.platform = 'instantly'
          AND EXISTS (SELECT 1 FROM dash_campaign_periods p
                       WHERE p.campaign_id = c.id AND p.grain = 'week' AND p.period_start >= $1)
        ORDER BY c.id`,
      [since]
    );

    // Resumable in both modes: a run cut short by the time budget continues from here next time.
    const startAt = saved?.mode === mode && saved.index < campaigns.length ? saved.index : 0;
    for (let i = startAt; i < campaigns.length; i++) {
      const c = campaigns[i];
      const sequence = Array.isArray(c.sequence) ? c.sequence : [];
      const syncedAt = new Date();
      const rows = (await campaignStepAnalytics(c.external_id))
        .filter(r => r.step !== null && r.step !== undefined && r.step !== '')
        .map(r => {
          const step = int(r.step);
          const variant = int(r.variant);
          const copy = sequence[step]?.variants?.[variant] || {};
          return [
            c.id, step, variant, copy.subject || null, copy.preview || null, int(r.sent), int(r.unique_replies),
            int(r.unique_replies_automatic), int(r.unique_opportunities ?? r.opportunities), syncedAt,
          ];
        });

      await withTx(async client => {
        await client.query(`DELETE FROM dash_campaign_steps WHERE campaign_id = $1`, [c.id]);
        await upsertRows('dash_campaign_steps', COLUMNS, rows, { conflict: ['campaign_id', 'step', 'variant'], client });
      });

      if (Date.now() > deadline && i + 1 < campaigns.length) {
        await saveCursor({ mode, index: i + 1 });
        return { complete: false, campaigns: i + 1 - startAt, resumeAt: i + 1, of: campaigns.length };
      }
    }

    await saveCursor(null);
    return { campaigns: campaigns.length - startAt, of: campaigns.length };
  },
};
