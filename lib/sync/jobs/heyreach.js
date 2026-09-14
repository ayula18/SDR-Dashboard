import { upsertRows, withTx } from '../../db.js';
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
export const job = {
  label: 'HeyReach campaigns and LinkedIn stats',

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
    const targets = campaigns.filter(c => c.status !== 'DRAFT' && (
      mode === 'full'
      || ['IN_PROGRESS', 'PAUSED'].includes(c.status)
      || new Date(c.creationTime || c.createdAt || 0).getTime() > recent));

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
      });

      synced++;
      if (Date.now() > deadline && synced < targets.length) return { complete: false, campaigns: campaigns.length, statsSynced: synced };
    }

    return { campaigns: campaigns.length, statsSynced: synced, senders: accounts.length };
  },
};
