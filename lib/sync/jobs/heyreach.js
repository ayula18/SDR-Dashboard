import { qp, upsertRows, withTx } from '../../db.js';
import {
  heyreachCampaignStats, heyreachConfigured, listHeyreachAccounts, listHeyreachCampaigns,
} from '../../outreach/heyreach.js';
import { isoDay, periodStart, today } from '../../outreach/dates.js';
import { loadCampaignParser } from '../parse.js';

const STATUS = { IN_PROGRESS: 'active', PAUSED: 'paused', STOPPED: 'paused', FINISHED: 'completed', DRAFT: 'draft' };
const LI_COLUMNS = ['connections_sent', 'connections_accepted', 'messages_sent', 'message_replies'];
const DAY_MS = 86_400_000;

/**
 * HeyReach campaigns plus invitations, acceptances, messages and replies,
 * bucketed into weeks and months from HeyReach's per-day stats.
 *
 * Sender accounts are senior people, not SDRs, and are stored separately in
 * `senders`; the SDR still comes from the campaign name.
 */
/** How stale a campaign's stats may get before they are worth another read. */
const LIVE_MAX_AGE_MS = 12 * 60 * 60 * 1000;   // running or paused: numbers move daily
const DONE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // finished: only late accepts and replies

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
    const recent = Date.now() - 45 * DAY_MS;
    const eligible = campaigns.filter(c => c.status !== 'DRAFT' && (
      mode === 'full'
      || ['IN_PROGRESS', 'PAUSED'].includes(c.status)
      || new Date(c.creationTime || c.createdAt || 0).getTime() > recent));

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

    // Only read what is actually out of date.
    //
    // The watermark alone decides the ORDER; on its own it never says "nothing
    // to do here", so the job always read until it ran out of time. That was
    // harmless at one run a night and wrong the moment the sync runs hourly: it
    // would re-read the freshest campaigns in the list forever, turning ~22
    // HeyReach calls a day into ~800 for no new numbers. HeyReach is read-only
    // and throttled, and the spend has to be justified (Ayush, sync caution).
    //
    // A running campaign's numbers move daily, so twice a day is plenty. A
    // finished one still gains the odd late accept or reply, so it is refreshed
    // weekly rather than never. `full` ignores both and re-reads everything.
    const freshEnough = (c) => {
      if (mode === 'full') return false;
      const read = readAt.get(String(c.id));
      if (!read) return false;
      const live = ['IN_PROGRESS', 'PAUSED'].includes(c.status);
      return Date.now() - read < (live ? LIVE_MAX_AGE_MS : DONE_MAX_AGE_MS);
    };
    const skipped = ordered.filter(freshEnough).length;
    const targets = ordered.filter(c => !freshEnough(c));

    let synced = 0;
    for (const c of targets) {
      const id = `heyreach:${c.id}`;
      const { overall, days } = await heyreachCampaignStats(c.id, { startDate, endDate });

      const buckets = new Map();
      for (const { date, stats } of days) {
        for (const grain of ['week', 'month']) {
          const key = `${grain}|${isoDay(periodStart(grain, date))}`;
          const bucket = buckets.get(key) || Object.fromEntries(LI_COLUMNS.map(k => [k, 0]));
          for (const k of LI_COLUMNS) bucket[k] += stats[k] || 0;
          buckets.set(key, bucket);
        }
      }
      const periodRows = [...buckets]
        .filter(([, b]) => LI_COLUMNS.some(k => b[k]))
        .map(([key, b]) => {
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
