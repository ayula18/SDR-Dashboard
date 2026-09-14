import { qp } from '../db.js';
import { isoDay, nextPeriod } from '../outreach/dates.js';
import { meetingTotals } from './core.js';
import { describeRange, trailingPeriods } from './filters.js';
import { change, rate } from './format.js';
import { Params, bucket, scope } from './sql.js';

/** Meeting rows from the audit sheet with their campaign attribution. */
export async function listMeetings(filters, { allTime = false, since = null, channel = null, limit = 500 } = {}) {
  const p = new Params();
  const where = [scope('meeting', 'm', filters, p)];
  if (since) where.push(`m.meeting_date >= ${p.add(since)}`);
  else if (!allTime) where.push(`m.meeting_date >= ${p.add(filters.from)}`, `m.meeting_date < ${p.add(filters.toExclusive)}`);
  if (filters.campaignId || filters.program) where.push('m.campaign_id IS NOT NULL');
  if (channel) where.push(`m.channel = ${p.add(channel)}`);

  return qp(`
    SELECT m.id, m.meeting_date::text AS date, m.company_domain AS domain, m.company_raw AS company,
           m.channel, m.source_of_meeting AS source, m.direction, m.attributed_sdr AS sdr,
           m.campaign_id AS "campaignId", m.campaign_name AS campaign, m.program,
           m.qualified, m.happened, m.did_happen AS held, m.deal_value::float AS "dealValue",
           m.segment, m.employee_bucket AS "employeeBucket", m.oss_type AS "ossType",
           m.champion_title AS "championTitle", m.senior_champion AS "seniorChampion"
      FROM dash_v_meetings m
     WHERE ${where.join(' AND ')}
     ORDER BY m.meeting_date DESC NULLS LAST
     LIMIT ${p.add(limit)}`, p.values);
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

  const withRates = r => ({ ...r, heldRate: rate(r.held, r.meetings), qualifiedRate: rate(r.qualified, r.meetings) });
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
