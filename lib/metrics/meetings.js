import { qp } from '../db.js';
import { isoDay, nextPeriod } from '../outreach/dates.js';
import { meetingTotals } from './core.js';
import { describeRange, trailingPeriods } from './filters.js';
import { change, rate } from './format.js';
import { Params, bucket, scope } from './sql.js';

/**
 * Meeting rows from the audit sheet with their campaign attribution. The range
 * is the filters' own unless `from`/`toExclusive`, `since` or `allTime` say
 * otherwise; `platform` keeps only the meetings credited to an email or
 * LinkedIn campaign.
 */
export async function listMeetings(filters, { allTime = false, since = null, from = null, toExclusive = null, channel = null, platform = null, outboundOnly = false, withRescheduled = true, limit = 500 } = {}) {
  const p = new Params();
  const where = [scope('meeting', 'm', filters, p)];
  // Lists keep the moved slots (that is how a reschedule is visible); counts drop them.
  if (!withRescheduled) where.push('NOT m.rescheduled');
  if (from || toExclusive) {
    if (from) where.push(`m.meeting_date >= ${p.add(from)}`);
    if (toExclusive) where.push(`m.meeting_date < ${p.add(toExclusive)}`);
  } else if (since) where.push(`m.meeting_date >= ${p.add(since)}`);
  else if (!allTime) where.push(`m.meeting_date >= ${p.add(filters.from)}`, `m.meeting_date < ${p.add(filters.toExclusive)}`);
  if (filters.campaignId || filters.program) where.push('m.campaign_id IS NOT NULL');
  if (channel) where.push(`m.channel = ${p.add(channel)}`);
  if (outboundOnly) where.push(`(m.direction ILIKE 'outbound' OR m.campaign_id IS NOT NULL)`);
  if (platform) where.push(`EXISTS (SELECT 1 FROM dash_v_campaigns mc WHERE mc.id = m.campaign_id AND mc.platform = ${p.add(platform)})`);

  return qp(`
    SELECT m.id, m.meeting_date::text AS date, m.company_domain AS domain, m.company_raw AS company,
           m.channel, m.source_of_meeting AS source, m.direction, m.attributed_sdr AS sdr,
           m.attribution, m.booking_by AS "bookingBy", m.influenced_sdr AS "influencedSdr",
           m.influenced_program AS "influencedProgram", m.influenced_days AS "influencedDays",
           m.influenced_campaign_name AS "influencedCampaign",
           m.campaign_id AS "campaignId", m.campaign_name AS campaign, m.program,
           m.qualified, m.happened, m.did_happen AS held, m.deal_value::float AS "dealValue",
           m.outcome, m.rescheduled, m.evidence_source AS "evidenceSource", m.evidence_note AS "evidenceNote",
           m.source AS "bookedVia",
           m.segment, m.employee_bucket AS "employeeBucket", m.oss_type AS "ossType",
           m.champion_title AS "championTitle", m.senior_champion AS "seniorChampion"
      FROM dash_v_meetings m
     WHERE ${where.join(' AND ')}
     ORDER BY m.meeting_date DESC NULLS LAST
     LIMIT ${p.add(limit)}`, p.values);
}

const lower = value => String(value ?? '').toLowerCase();

/**
 * The same totals meetingTotals computes, from rows already in hand. The
 * meetings view is expensive to query, so a page that needs several cuts of it
 * reads it once and counts here.
 */
export function totalsFromMeetings(allRows) {
  // A booking that moved is counted once, at the slot it moved to; it is still
  // listed, and counted on its own as `rescheduled`.
  const rows = allRows.filter(r => !r.rescheduled);
  const count = test => rows.filter(test).length;
  return {
    meetings: rows.length,
    sourced: count(r => r.attribution === 'sourced'),
    influenced: count(r => r.attribution === 'influenced'),
    held: count(r => r.held),
    qualified: count(r => r.qualified),
    noShow: count(r => r.outcome === 'no_show'),
    pendingReview: count(r => r.outcome === 'review'),
    upcoming: count(r => r.outcome === 'upcoming'),
    rescheduled: allRows.length - rows.length,
    seniorChampion: count(r => lower(r.seniorChampion) === 'yes'),
    pipelineValue: rows.reduce((total, r) => total + (r.qualified ? r.dealValue || 0 : 0), 0),
  };
}

/** Those totals per group, biggest first. `keyOf` names the group a meeting belongs to. */
export function groupMeetings(rows, keyOf) {
  const groups = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, ...totalsFromMeetings(group) }))
    .sort((a, b) => b.meetings - a.meetings);
}

const GROUPS = {
  byChannel: `COALESCE(m.channel, 'Unknown')`,
  bySdr: `COALESCE(m.attributed_sdr, 'Unattributed')`,
  byProgram: `COALESCE(m.program, 'none')`,
  bySegment: `COALESCE(m.segment, 'Unknown')`,
  byEmployees: `COALESCE(m.employee_bucket, 'Unknown')`,
  byOssType: `COALESCE(m.oss_type, 'Unknown')`,
  byDirection: `COALESCE(m.direction, 'Unknown')`,
};

/** Every meeting (inbound, referral, ads and outbound) with breakdowns and the period-on-period change. */
export async function getMeetings(filters, { channel = null } = {}) {
  const trendPeriods = trailingPeriods(filters.trendGrain, filters.to, 12);
  const trendRange = {
    from: trendPeriods[0],
    toExclusive: isoDay(nextPeriod(filters.trendGrain, trendPeriods[trendPeriods.length - 1])),
  };
  const groupNames = Object.keys(GROUPS);

  const [current, previous, trend, list, channels, ...groups] = await Promise.all([
    meetingTotals(filters, filters, null, { channel }),
    meetingTotals(filters, filters.previous, null, { channel }),
    meetingTotals(filters, trendRange, bucket(filters.trendGrain, 'm.meeting_date'), { channel }),
    listMeetings(filters, { channel }),
    qp(`SELECT channel FROM dash_meetings WHERE channel IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC`),
    ...groupNames.map(g => meetingTotals(filters, filters, GROUPS[g], { channel })),
  ]);

  // Held rate counts only the meetings there is something to judge: a slot still
  // ahead, and one that moved, are not misses.
  const withRates = r => ({
    ...r,
    heldRate: rate(r.held, r.meetings - (r.upcoming || 0)),
    qualifiedRate: rate(r.qualified, r.meetings),
  });
  const totals = withRates(current);

  return {
    range: describeRange(filters),
    channels: channels.map(c => c.channel),
    totals: {
      ...totals,
      previous: withRates(previous),
      change: Object.fromEntries(['meetings', 'held', 'qualified', 'pipelineValue'].map(k => [k, change(current[k], previous[k])])),
      seniorChampionRate: rate(current.seniorChampion, current.meetings),
      avgDealValue: current.qualified ? Math.round(current.pipelineValue / current.qualified) : null,
    },
    trend: trendPeriods.map(period => ({ period, meetings: 0, held: 0, qualified: 0, pipelineValue: 0, ...trend.find(t => t.key === period) })),
    ...Object.fromEntries(groupNames.map((g, i) => [g, groups[i].map(withRates).sort((a, b) => b.meetings - a.meetings)])),
    meetings: list,
  };
}
