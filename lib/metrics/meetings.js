import { qp } from '../db.js';
import { isoDay, nextPeriod } from '../outreach/dates.js';
import { meetingTotals } from './core.js';
import { describeRange, trailingPeriods } from './filters.js';
import { change, rate } from './format.js';
import { MEETING_CHANNEL_OF_PLATFORM, OUTREACH_MEETING, Params, bucket, scope } from './sql.js';

/**
 * Meeting rows SDR outreach booked (OUTREACH_MEETING, via scope), one per credited
 * SDR with its `share` (half each where the audit sheet splits a meeting), with the
 * campaign it came from and its channel. `platform` is that channel as a platform
 * ('instantly' for email, 'heyreach' for LinkedIn, null for a call or unknown), and
 * keeps only that channel's meetings when asked. The range is the filters' own unless
 * `from`/`toExclusive`, `since` or `allTime` say otherwise. Count with
 * totalsFromMeetings; list with oneRowPerMeeting.
 */
export async function listMeetings(filters, { allTime = false, since = null, from = null, toExclusive = null, channel = null, platform = null, withRescheduled = true, limit = 500 } = {}) {
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
  if (platform) where.push(`m.outreach_channel = ${p.add(MEETING_CHANNEL_OF_PLATFORM[platform] || platform)}`);

  return qp(`
    SELECT m.id, m.meeting_date::text AS date, m.company_domain AS domain, m.company_raw AS company,
           m.channel, m.source_of_meeting AS source, m.direction, m.attributed_sdr AS sdr, m.share,
           m.campaign_id AS "campaignId", m.campaign_name AS campaign, m.program,
           CASE m.outreach_channel WHEN 'email' THEN 'instantly' WHEN 'linkedin' THEN 'heyreach' END AS platform,
           m.outreach_channel AS "outreachChannel", m.credit_reason AS reason, m.who_sure AS "whoSure", m.where_sure AS "whereSure",
           m.happened, m.did_happen AS held,
           m.outcome, m.rescheduled, m.evidence_source AS "evidenceSource", m.evidence_note AS "evidenceNote",
           m.source AS "bookedVia",
           m.segment, m.employee_bucket AS "employeeBucket", m.oss_type AS "ossType",
           m.champion_title AS "championTitle", m.senior_champion AS "seniorChampion"
      FROM dash_v_meetings m
     WHERE ${where.join(' AND ')}
     ORDER BY m.meeting_date DESC NULLS LAST, m.id
     LIMIT ${p.add(limit)}`, p.values);
}

const weight = r => Number(r.share ?? 1);
const sumShares = rows => rows.reduce((total, r) => total + weight(r), 0);

/**
 * listMeetings' rows as a list of meetings: a meeting split between two SDRs is one
 * row, named "Akhil ½ + Dheeraj ½", with the share the rows held (1, or ½ where only
 * one of them was picked). Every list goes through here, so a split is never listed twice.
 */
export function oneRowPerMeeting(rows) {
  const byId = new Map();
  for (const r of rows) {
    const seen = byId.get(r.id);
    if (!seen) { byId.set(r.id, { ...r, credited: [{ sdr: r.sdr, share: weight(r) }] }); continue; }
    seen.credited.push({ sdr: r.sdr, share: weight(r) });
  }
  return [...byId.values()].map(({ credited, ...r }) => ({
    ...r,
    share: sumShares(credited),
    sdr: credited.length > 1 || credited[0].share < 1
      ? credited.map(c => `${c.sdr || 'Unattributed'}${c.share < 1 ? ' ½' : ''}`).join(' + ')
      : r.sdr,
  }));
}

/**
 * Meeting checks (Ayush, 2026-11-10): the meetings the credit could not settle, for
 * someone to answer by hand. Three kinds, each counted nowhere or in part until then:
 *   nobody  no HubSpot form or audit row names who booked it (the SDR team's booking
 *           link, or a HubSpot meeting with no owner): counted nowhere
 *   channel an SDR's meeting with no Email, LinkedIn or call to show: in totals only
 *   source  an SDR's meeting whose campaign is a guess: no reply found, only their
 *           outreach reached the company
 * An answer is the SDR's own word (setMeetingCampaign in lib/admin.js), so the meeting
 * leaves this list as soon as it is given. With each, the campaigns that reached the
 * company, to pick from.
 */
export async function getMeetingChecks(filters) {
  const p = new Params();
  const where = [
    `m.meeting_date >= ${p.add(filters.from)}`, `m.meeting_date < ${p.add(filters.toExclusive)}`, 'NOT m.rescheduled',
    `(m.booking_by = 'unknown' OR (${OUTREACH_MEETING('m')} AND (m.outreach_channel = 'unknown' OR m.where_sure = 'unsure')))`,
  ];
  if (filters.sdr) {
    const sdrs = Array.isArray(filters.sdr) ? filters.sdr : [filters.sdr];
    where.push(`(m.booking_by = 'unknown' OR m.attributed_sdr = ANY(${p.add(sdrs)}::text[]))`);
  }
  const rows = oneRowPerMeeting(await qp(`
    SELECT m.id, m.meeting_date::text AS date, m.company_domain AS domain, m.company_raw AS company,
           m.booking_by AS "bookingBy", m.attributed_sdr AS sdr, m.share, m.campaign_id AS "campaignId", m.campaign_name AS campaign,
           m.outreach_channel AS channel, m.who_sure AS "whoSure", m.where_sure AS "whereSure", m.credit_reason AS reason,
           m.source AS "bookedVia", m.source_of_meeting AS "sourceOfMeeting", m.channel AS team
      FROM dash_v_meetings m
     WHERE ${where.join(' AND ')}
     ORDER BY m.meeting_date DESC, m.id`, p.values));

  // The campaigns that reached each company, broadcasts aside: what an answer picks from.
  const domains = [...new Set(rows.map(r => r.domain).filter(Boolean))];
  const reached = domains.length ? await qp(`
    WITH spellings AS (
      SELECT d AS raw, d AS domain FROM unnest($1::text[]) d
      UNION SELECT cd.domain, cd.canonical_domain FROM dash_company_domains cd WHERE cd.canonical_domain = ANY($1::text[])
    )
    SELECT DISTINCT x.domain, c.id, c.name, c.platform, c.sdr
      FROM (SELECT s.domain, l.campaign_id FROM dash_leads l JOIN spellings s ON s.raw = l.company_domain
            UNION SELECT l.company_domain, l.campaign_id FROM dash_v_linkedin_leads l
                   WHERE l.company_domain = ANY($1::text[]) AND l.reached) x
      JOIN dash_v_campaigns c ON c.id = x.campaign_id AND NOT c.excluded AND c.kind <> 'broadcast'`, [domains]) : [];
  const byDomain = new Map();
  for (const c of reached) byDomain.set(c.domain, [...(byDomain.get(c.domain) || []), { id: c.id, name: c.name, platform: c.platform, sdr: c.sdr }]);

  const kindOf = r => (r.bookingBy === 'unknown' ? 'nobody' : r.channel === 'unknown' ? 'channel' : 'source');
  return {
    range: describeRange(filters),
    checks: rows.map(r => ({
      ...r,
      kind: kindOf(r),
      campaigns: (byDomain.get(r.domain) || []).sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}

/** SDR-booked meetings in [from, toExclusive) per platform, from rows listMeetings returned. */
export function meetingsByPlatform(rows, { from, toExclusive }) {
  const counted = rows.filter(r => !r.rescheduled && r.date && r.date >= from && r.date < toExclusive);
  return {
    email: sumShares(counted.filter(r => r.platform === 'instantly')),
    linkedin: sumShares(counted.filter(r => r.platform === 'heyreach')),
  };
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
  // Rows are one per credited SDR, so meetings are their shares summed (MEETINGS in sql.js).
  const rows = allRows.filter(r => !r.rescheduled);
  const count = test => sumShares(rows.filter(test));
  return {
    meetings: sumShares(rows),
    held: count(r => r.held),
    noShow: count(r => r.outcome === 'no_show'),
    pendingReview: count(r => r.outcome === 'review'),
    upcoming: count(r => r.outcome === 'upcoming'),
    rescheduled: sumShares(allRows) - sumShares(rows),
    seniorChampion: count(r => lower(r.seniorChampion) === 'yes'),
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

/** Every meeting SDR outreach booked, with breakdowns and the period-on-period change. */
export async function getMeetings(filters, { channel = null } = {}) {
  const trendPeriods = trailingPeriods(filters.trendGrain, filters.to, 12);
  const trendRange = {
    from: trendPeriods[0],
    toExclusive: isoDay(nextPeriod(filters.trendGrain, trendPeriods[trendPeriods.length - 1])),
  };
  const groupNames = Object.keys(GROUPS);

  const [current, previous, trend, list, ...groups] = await Promise.all([
    meetingTotals(filters, filters, null, { channel }),
    meetingTotals(filters, filters.previous, null, { channel }),
    meetingTotals(filters, trendRange, bucket(filters.trendGrain, 'm.meeting_date'), { channel }),
    listMeetings(filters, { channel }),
    ...groupNames.map(g => meetingTotals(filters, filters, GROUPS[g], { channel })),
  ]);
  // The channel filter offers what SDR-booked meetings in the range carry (the
  // sheet's label), plus the one picked, so picking one doesn't hide the rest.
  const byChannel = groups[groupNames.indexOf('byChannel')];
  const channels = [...new Set([...byChannel.map(g => g.key).filter(k => k !== 'Unknown'), ...(channel ? [channel] : [])])];

  // Held rate counts only the meetings there is something to judge: a slot still
  // ahead, and one that moved, are not misses.
  const withRates = r => ({
    ...r,
    heldRate: rate(r.held, r.meetings - (r.upcoming || 0)),
  });
  const totals = withRates(current);

  return {
    range: describeRange(filters),
    channels,
    totals: {
      ...totals,
      previous: withRates(previous),
      change: Object.fromEntries(['meetings', 'held'].map(k => [k, change(current[k], previous[k])])),
      seniorChampionRate: rate(current.seniorChampion, current.meetings),
    },
    trend: trendPeriods.map(period => ({ period, meetings: 0, held: 0, ...trend.find(t => t.key === period) })),
    ...Object.fromEntries(groupNames.map((g, i) => [g, groups[i].map(withRates).sort((a, b) => b.meetings - a.meetings)])),
    meetings: oneRowPerMeeting(list),
  };
}
