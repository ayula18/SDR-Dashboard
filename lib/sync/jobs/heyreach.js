import { qp, upsertRows, withTx } from '../../db.js';
import {
  heyreachCampaignStats, heyreachConfigured, listHeyreachAccounts, listHeyreachCampaigns,
} from '../../outreach/heyreach.js';
import { isoDay, periodStart, toDay, today } from '../../outreach/dates.js';
import { loadCampaignParser } from '../parse.js';

const STATUS = { IN_PROGRESS: 'active', PAUSED: 'paused', STOPPED: 'paused', FINISHED: 'completed', DRAFT: 'draft' };
const LI_COLUMNS = ['connections_sent', 'connections_accepted', 'messages_sent', 'message_replies'];
const DAY_MS = 86_400_000;

/** HeyReach's per-day stats as stored rows' numbers: one bucket per day, week and month that had any activity. */
export function periodBuckets(days) {
  const buckets = new Map();
  for (const { date, stats } of days) {
    for (const grain of ['day', 'week', 'month']) {
      const key = `${grain}|${isoDay(periodStart(grain, date))}`;
      const bucket = buckets.get(key) || Object.fromEntries(LI_COLUMNS.map(k => [k, 0]));
      for (const k of LI_COLUMNS) bucket[k] += stats[k] || 0;
      buckets.set(key, bucket);
    }
  }
  return [...buckets].filter(([, b]) => LI_COLUMNS.some(k => b[k]));
}

/**
 * HeyReach campaigns plus invitations, acceptances, messages and replies,
 * bucketed into days, weeks and months from HeyReach's per-day stats.
 *
 * Sender accounts are senior people, not SDRs, and are stored separately in
 * `senders`; the SDR still comes from the campaign name.
 */
/** How stale a campaign's stats may get before they are worth another read. */
const LIVE_MAX_AGE_MS = 12 * 60 * 60 * 1000;   // running or paused: numbers move daily
const DONE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // finished: only late accepts and replies
const JUST_ACTIVE_MS = 3 * DAY_MS;
const RECENT_MS = 45 * DAY_MS;
const RUNNING = ['IN_PROGRESS', 'PAUSED'];

/**
 * Whether a campaign is on this run's list at all: `activity` is its last week and
 * last day with any numbers. Running, new, or active in the last 45 days, because a
 * finished campaign is still settling. This went by creation date alone, so a campaign
 * that ran longer than 45 days never got a read after it finished: 17 campaigns froze
 * short, such as Harshini_Suman_Starting23/07 at 39 invites of 47 and 9 accepted of 12.
 * Weeks with no days means stored before days were, or rewritten by a deploy that keeps
 * none; one read fixes that, so it needs no --full and ends itself.
 */
export function isEligible(c, { mode, activity = {}, now }) {
  if (c.status === 'DRAFT') return false;
  return mode === 'full'
    || RUNNING.includes(c.status)
    || new Date(c.creationTime || c.createdAt || 0).getTime() > now - RECENT_MS
    || (activity.lastWeek != null && (activity.lastDay == null || new Date(activity.lastWeek).getTime() > now - RECENT_MS));
}

/**
 * Whether its stats can wait. The watermark alone decides the ORDER; on its own it never
 * says "nothing to do here", so the job always read until it ran out of time. That was
 * harmless at one run a night and wrong the moment the sync runs hourly: it would re-read
 * the freshest campaigns in the list forever, turning ~22 HeyReach calls a day into ~800
 * for no new numbers. HeyReach is read-only and throttled, and the spend has to be
 * justified (Ayush, sync caution).
 *
 * A running campaign's numbers move daily, so twice a day is plenty, and so do those of
 * one that stopped in the last few days. Those are also read once after every UTC midnight,
 * or day on day would compare a day whose evening nobody has read yet (Ayush, 2026-11-06:
 * last full periods only). At a run every 6 hours that stays about two reads a day. Any
 * other finished campaign still gains the odd late accept or reply, so it is refreshed
 * weekly rather than never. `full` ignores all of this and re-reads everything.
 */
export function isFresh(c, { mode, readAt, activity = {}, now }) {
  if (mode === 'full' || (activity.lastWeek != null && activity.lastDay == null) || !readAt) return false;
  const live = RUNNING.includes(c.status) || (activity.lastDay != null && new Date(activity.lastDay).getTime() > now - JUST_ACTIVE_MS);
  if (live && readAt < toDay(new Date(now)).getTime()) return false;
  return now - readAt < (live ? LIVE_MAX_AGE_MS : DONE_MAX_AGE_MS);
}

export const job = {
  label: 'HeyReach campaigns and LinkedIn stats',
  weight: 2,
  minSliceMs: 30_000,
  maxAgeHours: 48,

  async run({ mode, deadline }) {
    if (!heyreachConfigured()) return { status: 'skipped', reason: 'HEYREACH_API_KEY is not set' };

    const parse = await loadCampaignParser();
    const [campaigns, accounts] = await Promise.all([listHeyreachCampaigns(), listHeyreachAccounts()]);
    const senderName = new Map(accounts.map(a => [
      String(a.id),
      [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.emailAddress || `account ${a.id}`,
    ]));
    const syncedAt = new Date();

    await upsertRows(
      'dash_campaigns',
      ['id', 'platform', 'external_id', 'name', 'status', 'status_raw', 'created_at_src', 'parsed_sdr',
        'parsed_program', 'parsed_theme', 'parsed_segment', 'parsed_region', 'senders', 'synced_at'],
      campaigns.map(c => {
        const p = parse(c.name);
        return [
          `heyreach:${c.id}`, 'heyreach', String(c.id), c.name || '(unnamed)', STATUS[c.status] || 'other',
          String(c.status ?? ''), c.creationTime || c.createdAt || null, p.sdr, p.program, p.theme, p.segment, p.region,
          (c.campaignAccountIds || []).map(id => senderName.get(String(id)) || `account ${id}`), syncedAt,
        ];
      }),
      { conflict: ['id'] }
    );

    const startDate = process.env.DASH_START_DATE || '2026-01-05';
    const endDate = isoDay(today());
    const now = Date.now();
    const activity = new Map((await qp(`
      SELECT campaign_id,
             max(period_start) FILTER (WHERE grain = 'week')::text AS "lastWeek",
             max(period_start) FILTER (WHERE grain = 'day')::text AS "lastDay"
        FROM dash_campaign_periods
       WHERE campaign_id LIKE 'heyreach:%'
       GROUP BY 1`
    )).map(r => [r.campaign_id, r]));
    const activityOf = c => activity.get(`heyreach:${c.id}`);
    const eligible = campaigns.filter(c => isEligible(c, { mode, activity: activityOf(c), now }));

    // Least recently read first, so a run that only gets through part of the list
    // starts on the untouched ones next time. This job had no cursor at all: it
    // walked from index 0 every run, so a budget covering 70 of 241 campaigns
    // re-read the same 70 nightly and never reached the rest.
    //
    // The watermark lives on the campaign row rather than in a saved index,
    // because `campaigns` comes back in whatever order the API returns — an
    // index into a re-sorted or shrunk list silently SKIPS campaigns, which is
    // a worse failure than re-reading them.
    const readAt = new Map(
      (await qp(
        `SELECT external_id, stats_read_at FROM dash_campaigns
          WHERE platform = 'heyreach' AND stats_read_at IS NOT NULL`
      )).map(r => [String(r.external_id), new Date(r.stats_read_at).getTime()])
    );
    const ordered = eligible.sort((a, b) =>
      (readAt.get(String(a.id)) ?? 0) - (readAt.get(String(b.id)) ?? 0));

    const freshEnough = c => isFresh(c, { mode, readAt: readAt.get(String(c.id)), activity: activityOf(c), now });
    const skipped = ordered.filter(freshEnough).length;
    const targets = ordered.filter(c => !freshEnough(c));

    let synced = 0;
    for (const c of targets) {
      const id = `heyreach:${c.id}`;
      const { overall, days } = await heyreachCampaignStats(c.id, { startDate, endDate });

      const periodRows = periodBuckets(days).map(([key, b]) => {
        const [grain, start] = key.split('|');
        return [id, grain, start, ...LI_COLUMNS.map(k => b[k]), syncedAt];
      });

      await withTx(async client => {
        await client.query(`DELETE FROM dash_campaign_periods WHERE campaign_id = $1`, [id]);
        await upsertRows('dash_campaign_periods', ['campaign_id', 'grain', 'period_start', ...LI_COLUMNS, 'synced_at'],
          periodRows, { conflict: ['campaign_id', 'grain', 'period_start'], client });
        await upsertRows('dash_campaign_stats',
          ['campaign_id', 'connections_sent', 'connections_accepted', 'messages_sent', 'message_replies', 'inmails_sent', 'inmail_replies', 'synced_at'],
          [[id, overall.connections_sent, overall.connections_accepted, overall.messages_sent, overall.message_replies, overall.inmails_sent, overall.inmail_replies, syncedAt]],
          { conflict: ['campaign_id'], client });
        // Stamped in the same transaction as the data it describes, so the
        // watermark can never claim a read that did not land.
        await client.query(`UPDATE dash_campaigns SET stats_read_at = NOW() WHERE id = $1`, [id]);
      });

      synced++;
      if (Date.now() > deadline && synced < targets.length) {
        return { complete: false, campaigns: campaigns.length, statsSynced: synced, stillStale: targets.length - synced, alreadyFresh: skipped };
      }
    }

    return { campaigns: campaigns.length, statsSynced: synced, alreadyFresh: skipped, senders: accounts.length };
  },
};
