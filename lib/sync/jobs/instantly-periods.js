import { qp, upsertRows, withTx } from '../../db.js';
import { campaignAnalytics, instantlyConfigured } from '../../outreach/instantly.js';
import { addDays, isoDay, monthStart, periodEnd, periodsBetween, today } from '../../outreach/dates.js';

const COLUMNS = [
  'campaign_id', 'grain', 'period_start', 'sent', 'contacted', 'new_leads_contacted', 'replies_unique',
  'auto_replies_unique', 'bounced', 'unsubscribed', 'opportunities', 'synced_at',
];
const int = v => Number.parseInt(v, 10) || 0;

/**
 * Week-by-week and month-by-month activity per campaign.
 *
 * Instantly's analytics endpoint accepts a date range and returns every
 * campaign at once, so a week costs one request however many campaigns ran.
 * Full mode backfills from DASH_START_DATE; incremental refreshes the last
 * three weeks and the last two months (replies keep arriving after a send).
 */
export const job = {
  label: 'Instantly weekly and monthly activity',

  async run({ mode, log }) {
    if (!instantlyConfigured()) return { status: 'skipped', reason: 'INSTANTLY_API_KEY is not set' };

    const now = today();
    const start = process.env.DASH_START_DATE || '2026-01-05';
    const plan = mode === 'full'
      ? [['week', periodsBetween('week', start, now)], ['month', periodsBetween('month', start, now)]]
      : [['week', periodsBetween('week', addDays(now, -14), now)], ['month', periodsBetween('month', addDays(monthStart(now), -1), now)]];

    const known = new Set((await qp(`SELECT id FROM dash_campaigns WHERE platform = 'instantly'`)).map(r => r.id));
    let periods = 0;
    let rows = 0;
    let unknownCampaigns = 0;

    for (const [grain, starts] of plan) {
      for (const startIso of starts) {
        const analytics = await campaignAnalytics({ startDate: startIso, endDate: isoDay(periodEnd(grain, startIso)) });
        const syncedAt = new Date();
        const out = [];
        for (const a of analytics) {
          const values = [
            int(a.emails_sent_count), int(a.contacted_count), int(a.new_leads_contacted_count), int(a.reply_count_unique),
            int(a.reply_count_automatic_unique), int(a.bounced_count), int(a.unsubscribed_count), int(a.total_opportunities),
          ];
          if (!values.some(Boolean)) continue;
          const id = `instantly:${a.campaign_id}`;
          if (!known.has(id)) { unknownCampaigns++; continue; }
          out.push([id, grain, startIso, ...values, syncedAt]);
        }

        // Replace the whole period, so a campaign whose numbers dropped to zero doesn't linger.
        await withTx(async client => {
          await client.query(
            `DELETE FROM dash_campaign_periods WHERE grain = $1 AND period_start = $2 AND campaign_id LIKE 'instantly:%'`,
            [grain, startIso]
          );
          await upsertRows('dash_campaign_periods', COLUMNS, out, { conflict: ['campaign_id', 'grain', 'period_start'], client });
        });
        periods++;
        rows += out.length;
      }
      log(`${grain}: ${starts.length} periods`);
    }

    return { periods, rows, unknownCampaigns };
  },
};
