import { qp, upsertRows, withTx } from '../../db.js';
import { campaignAnalytics, configuredWorkspaces, instantlyConfigured } from '../../outreach/instantly.js';
import { addDays, isoDay, monthStart, periodEnd, periodsBetween, today } from '../../outreach/dates.js';

const COLUMNS = [
  'campaign_id', 'grain', 'period_start', 'sent', 'contacted', 'new_leads_contacted', 'replies_unique',
  'auto_replies_unique', 'bounced', 'unsubscribed', 'opportunities', 'synced_at',
];
const int = v => Number.parseInt(v, 10) || 0;

/**
 * The periods one run reads, days last: a full backfill cut short has its weeks and
 * months first. Incremental refreshes the last three weeks and the last two months
 * (replies keep arriving after a send) and the last three days, which is what makes
 * yesterday whole however late in the day the last run before midnight was.
 */
export function periodPlan(mode, now, start) {
  if (mode === 'full') return ['week', 'month', 'day'].map(grain => [grain, periodsBetween(grain, start, now)]);
  return [
    ['week', periodsBetween('week', addDays(now, -14), now)],
    ['month', periodsBetween('month', addDays(monthStart(now), -1), now)],
    ['day', periodsBetween('day', addDays(now, -2), now)],
  ];
}

/**
 * Day-by-day, week-by-week and month-by-month activity per campaign.
 *
 * Instantly's analytics endpoint accepts a date range and returns every
 * campaign at once, so a period costs one request per workspace however many
 * campaigns ran. Full mode backfills from DASH_START_DATE; see periodPlan.
 *
 * Both workspaces are read into one list before the period is rewritten. They
 * cannot be written one after the other: the write replaces the whole period
 * for every Instantly campaign, so the second workspace's rows would delete
 * the first's.
 */
export const job = {
  label: 'Instantly daily, weekly and monthly activity',
  dependsOn: ['instantly-campaigns'],
  weight: 1,
  minSliceMs: 20_000,
  maxAgeHours: 36,

  async run({ mode, log, deadline }) {
    if (!instantlyConfigured()) return { status: 'skipped', reason: 'no Instantly API key is set' };

    const now = today();
    const start = process.env.DASH_START_DATE || '2026-01-05';
    const plan = periodPlan(mode, now, start);

    const workspaces = configuredWorkspaces();
    // Only campaigns of the workspaces read below: the period rewrite is scoped to them.
    const known = new Set((await qp(
      `SELECT id FROM dash_campaigns WHERE platform = 'instantly' AND workspace = ANY($1::text[])`,
      [workspaces.map(w => w.id)]
    )).map(r => r.id));
    let periods = 0;
    let rows = 0;
    let unknownCampaigns = 0;

    for (const [grain, starts] of plan) {
      for (const startIso of starts) {
        // A full backfill is over 700 reads, more than a platform time limit allows.
        if (deadline && Date.now() > deadline) return { complete: false, periods, rows, unknownCampaigns, workspaces: workspaces.length };
        const endDate = isoDay(periodEnd(grain, startIso));
        const analytics = (await Promise.all(
          workspaces.map(w => campaignAnalytics({ startDate: startIso, endDate, workspace: w.id }))
        )).flat();
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

        // Replace the whole period, so a campaign whose numbers dropped to zero doesn't linger —
        // but only for the workspaces just read. A workspace whose key is missing here keeps
        // its rows; deleting them is how the AI SDR workspace's weeks kept vanishing.
        await withTx(async client => {
          await client.query(
            `DELETE FROM dash_campaign_periods p
              USING dash_campaigns c
              WHERE c.id = p.campaign_id AND c.platform = 'instantly' AND c.workspace = ANY($3::text[])
                AND p.grain = $1 AND p.period_start = $2`,
            [grain, startIso, workspaces.map(w => w.id)]
          );
          await upsertRows('dash_campaign_periods', COLUMNS, out, { conflict: ['campaign_id', 'grain', 'period_start'], client });
        });
        periods++;
        rows += out.length;
      }
      log(`${grain}: ${starts.length} periods`);
    }

    return { periods, rows, unknownCampaigns, workspaces: workspaces.length };
  },
};
