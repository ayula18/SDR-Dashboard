import { qp } from '../db.js';
import { isoDay, nextPeriod, periodsBetween } from '../outreach/dates.js';
import { emailActivity, leadOutcomes, lifetimeLeads, lifetimeMeetings, lifetimePlatform, linkedinActivity, meetingTotals, recentReplies } from './core.js';
import { listCampaigns } from './campaigns.js';
import { companiesAcrossChannels, summarizeCompanies } from './companies.js';
import { dashStartDate, describeRange, trailingPeriods } from './filters.js';
import { change, notFound, rate } from './format.js';
import { LI_REPLY_AT, linkedinOutcomes } from './linkedin.js';
import { bucket } from './sql.js';
import { getTrendSeries } from './trends.js';

/**
 * The outreach funnel for a program, in two units:
 *   volume   what went out: emails, leads contacted, LinkedIn invites and messages
 *   people   leads and accounts: loaded → contacted → replied → positive → meeting → held → qualified
 */
function buildFunnel(leads, meetings, platform) {
  return {
    volume: {
      emailsSent: platform.emailsSent,
      leadsContacted: platform.leadsContacted,
      autoReplies: platform.autoReplies,
      bounced: platform.bounced,
      linkedinInvitesSent: platform.linkedinInvitesSent,
      linkedinInvitesAccepted: platform.linkedinInvitesAccepted,
      linkedinMessagesSent: platform.linkedinMessagesSent,
      linkedinReplies: platform.linkedinReplies,
      bounceRate: rate(platform.bounced, platform.emailsSent),
      inviteAcceptanceRate: rate(platform.linkedinInvitesAccepted, platform.linkedinInvitesSent),
    },
    leads: [
      { key: 'leadsLoaded', label: 'Leads loaded', value: leads.leadsLoaded },
      { key: 'leadsContacted', label: 'Contacted', value: leads.leadsContacted },
      { key: 'replied', label: 'Replied', value: leads.replied },
      { key: 'positive', label: 'Positive', value: leads.positive },
      { key: 'meetings', label: 'Meetings', value: meetings.meetings },
      { key: 'held', label: 'Held', value: meetings.held },
      { key: 'qualified', label: 'Qualified', value: meetings.qualified },
    ],
    accounts: [
      { key: 'accountsLoaded', label: 'Accounts targeted', value: leads.accountsLoaded },
      { key: 'accountsContacted', label: 'Contacted', value: leads.accountsContacted },
      { key: 'accountsReplied', label: 'Replied', value: leads.accountsReplied },
      { key: 'accountsPositive', label: 'Positive', value: leads.accountsPositive },
      { key: 'accountsWithMeeting', label: 'With a meeting', value: meetings.accountsWithMeeting },
    ],
    rates: {
      replyRate: rate(leads.replied, leads.leadsContacted),
      positiveRate: rate(leads.positive, leads.leadsContacted),
      meetingPerPositive: rate(meetings.meetings, leads.positive),
      pipelineValue: meetings.pipelineValue,
    },
  };
}

/** All programs with their funnel since DASH_START_DATE and this range vs the previous one. */
export async function listPrograms(filters) {
  const since = dashStartDate();
  const f = { ...filters, program: null };
  const [programs, campaigns, leads, meetings, platform, email, emailPrev, out, outPrev, mtg, mtgPrev, li, liPrev] = await Promise.all([
    qp(`SELECT slug, name, poc_name AS poc, description FROM dash_programs WHERE is_active ORDER BY sort_order`),
    qp(`SELECT program, count(*)::int AS campaigns, count(*) FILTER (WHERE status = 'active')::int AS active,
               array_agg(DISTINCT sdr) FILTER (WHERE sdr IS NOT NULL) AS sdrs,
               min(created_at_src) AS first_campaign_at, max(created_at_src) AS last_campaign_at
          FROM dash_v_campaigns
         WHERE NOT excluded AND program IS NOT NULL AND created_at_src >= $1
         GROUP BY 1`, [since]),
    lifetimeLeads(f, { since, groupBy: 'l.program' }),
    lifetimeMeetings(f, { since, groupBy: 'm.program' }),
    lifetimePlatform(f, { since, groupBy: 'c.program' }),
    emailActivity(f, f, 'c.program'),
    emailActivity(f, f.previous, 'c.program'),
    leadOutcomes(f, f, 'l.program'),
    leadOutcomes(f, f.previous, 'l.program'),
    meetingTotals(f, f, 'm.program'),
    meetingTotals(f, f.previous, 'm.program'),
    linkedinActivity(f, f, 'c.program'),
    linkedinActivity(f, f.previous, 'c.program'),
  ]);

  const pick = (rows, slug, keyName = 'key') => rows.find(r => r[keyName] === slug) || {};
  const zeroLeads = { leadsLoaded: 0, accountsLoaded: 0, leadsContacted: 0, accountsContacted: 0, replied: 0, accountsReplied: 0, positive: 0, accountsPositive: 0, negative: 0, campaigns: 0 };
  const zeroMeetings = { meetings: 0, accountsWithMeeting: 0, held: 0, qualified: 0, pipelineValue: 0 };
  const zeroPlatform = { emailsSent: 0, leadsContacted: 0, autoReplies: 0, bounced: 0, opportunities: 0, linkedinInvitesSent: 0, linkedinInvitesAccepted: 0, linkedinMessagesSent: 0, linkedinReplies: 0 };
  const prorate = v => Math.round((v || 0) * f.elapsedShare);

  return {
    range: describeRange(f),
    since,
    programs: programs.map(p => {
      const c = pick(campaigns, p.slug, 'program');
      const e = pick(email, p.slug), ep = pick(emailPrev, p.slug);
      const o = pick(out, p.slug), op = pick(outPrev, p.slug);
      const m = pick(mtg, p.slug), mp = pick(mtgPrev, p.slug);
      const l = pick(li, p.slug), lp = pick(liPrev, p.slug);
      const period = {
        emailsSent: e.sent || 0,
        leadsContacted: e.leadsContacted || 0,
        linkedinInvitesSent: l.invitesSent || 0,
        linkedinMessagesSent: l.messagesSent || 0,
        replies: o.replied || 0,
        positive: o.positive || 0,
        meetings: m.meetings || 0,
      };
      const previous = {
        emailsSent: prorate(ep.sent),
        leadsContacted: prorate(ep.leadsContacted),
        linkedinInvitesSent: prorate(lp.invitesSent),
        linkedinMessagesSent: prorate(lp.messagesSent),
        replies: op.replied || 0,
        positive: op.positive || 0,
        meetings: mp.meetings || 0,
      };
      return {
        ...p,
        campaigns: c.campaigns || 0,
        activeCampaigns: c.active || 0,
        sdrs: c.sdrs || [],
        firstCampaignAt: c.first_campaign_at || null,
        lastCampaignAt: c.last_campaign_at || null,
        funnel: buildFunnel(
          { ...zeroLeads, ...pick(leads, p.slug) },
          { ...zeroMeetings, ...pick(meetings, p.slug) },
          { ...zeroPlatform, ...pick(platform, p.slug) },
        ),
        period,
        previous,
        change: Object.fromEntries(Object.keys(period).map(k => [k, change(period[k], previous[k])])),
      };
    }),
  };
}

export const PROGRAM_CHANNELS = ['both', 'email', 'linkedin'];
const PLATFORM = { email: 'instantly', linkedin: 'heyreach' };
const TREND_ACTIVITY = ['sent', 'leadsContacted', 'linkedinInvitesSent', 'linkedinMessagesSent', 'replies', 'linkedinReplied', 'positive', 'linkedinPositive', 'meetings'];

/** The day the program's first campaign since DASH_START_DATE was created, or null when it has none. */
export async function programStart(slug) {
  const [row] = await qp(
    `SELECT min(created_at_src)::date::text AS start
       FROM dash_v_campaigns
      WHERE program = $1 AND NOT excluded AND created_at_src >= $2`,
    [slug, dashStartDate()]
  );
  return row?.start || null;
}

/** What went out on email and came back, in a range: Instantly volumes, and replies counted per lead. */
const emailCard = (activity, replies) => ({
  peopleEmailed: activity.leadsContacted,
  emailsSent: activity.sent,
  bounced: activity.bounced,
  replied: replies.replied,
  positive: replies.positive,
  negative: replies.negative,
  replyRate: rate(replies.replied, activity.leadsContacted),
  bounceRate: rate(activity.bounced, activity.sent),
});

/** The same for LinkedIn: HeyReach volumes, and replies counted per person. */
const linkedinCard = (activity, replies) => ({
  invitesSent: activity.invitesSent,
  accepted: activity.invitesAccepted,
  messagesSent: activity.messagesSent,
  replied: replies.replied,
  positive: replies.positive,
  negative: replies.negative,
  acceptanceRate: rate(activity.invitesAccepted, activity.invitesSent),
});

// Whole-period platform volumes; pro-rated for comparison while a range is still running.
const VOLUMES = new Set(['peopleEmailed', 'emailsSent', 'bounced', 'invitesSent', 'accepted', 'messagesSent']);

function changesAgainst(current, previous, elapsedShare) {
  return Object.fromEntries(Object.keys(current)
    .filter(key => !key.endsWith('Rate'))
    .map(key => [key, change(current[key], VOLUMES.has(key) ? Math.round((previous[key] || 0) * elapsedShare) : previous[key])]));
}

/** Meetings at the listed companies on or after each one's first touch, from the audit sheet. */
async function meetingsAtCompanies(companies) {
  const firstTouch = new Map(companies.filter(c => c.domain && c.meetings > 0).map(c => [c.domain, isoDay(c.firstTouchAt)]));
  if (!firstTouch.size) return [];
  const rows = await qp(`
    SELECT m.id, m.meeting_date::text AS date, m.company_domain AS domain, m.company_raw AS company,
           m.channel, m.source_of_meeting AS source, m.direction, m.attributed_sdr AS sdr,
           m.campaign_id AS "campaignId", m.campaign_name AS campaign, m.qualified, m.happened,
           m.did_happen AS held, m.deal_value::float AS "dealValue", m.segment,
           m.champion_title AS "championTitle", m.senior_champion AS "seniorChampion"
      FROM dash_v_meetings m
     WHERE m.company_domain = ANY($1::text[])
     ORDER BY m.meeting_date DESC NULLS LAST`, [[...firstTouch.keys()]]);
  return rows.filter(r => r.date && r.date >= firstTouch.get(r.domain));
}

/**
 * One program on one page, for a range and a channel (both | email | linkedin):
 *   companies  touched in the range, with everything that has come of them since
 *   email      what went out on Instantly and came back in the range
 *   linkedin   the same on HeyReach
 * plus campaigns, a trend, SDRs, meetings and the latest replies. Comparisons
 * with the previous range are skipped for since-start, which has none.
 */
export async function getProgramDetail(slug, filters, { channel = 'both' } = {}) {
  const [program] = await qp(`SELECT slug, name, poc_name AS poc, description, match_pattern AS "matchPattern" FROM dash_programs WHERE slug = $1`, [slug]);
  if (!program) throw notFound(`No program ${slug}`);

  const view = PROGRAM_CHANNELS.includes(channel) ? channel : 'both';
  const email = view !== 'linkedin';
  const linkedin = view !== 'email';
  const f = { ...filters, program: slug };
  const sinceStart = f.preset === 'since-start';
  const compare = !sinceStart;

  const grain = f.trendGrain;
  const periods = sinceStart ? periodsBetween(grain, f.from, f.to) : trailingPeriods(grain, f.to, 12);
  const trendRange = { grain, periods, from: periods[0], toExclusive: isoDay(nextPeriod(grain, periods[periods.length - 1])) };
  const sdrKey = alias => `COALESCE(${alias}.sdr, 'Unattributed')`;
  const none = value => Promise.resolve(value);

  const [
    [seen], companies,
    emailNow, emailRepliesNow, linkedinNow, linkedinRepliesNow,
    emailPrev, emailRepliesPrev, linkedinPrev, linkedinRepliesPrev,
    trend, linkedinTrend, campaigns,
    sdrEmail, sdrEmailReplies, sdrLinkedin, sdrLinkedinReplies,
    replies,
  ] = await Promise.all([
    qp(`SELECT bool_or(platform = 'instantly') AS email, bool_or(platform = 'heyreach') AS linkedin
          FROM dash_v_campaigns WHERE program = $1 AND NOT excluded`, [slug]),
    companiesAcrossChannels(f, { from: f.from, toExclusive: f.toExclusive, channel: view }),
    email ? emailActivity(f, f) : none(null),
    email ? leadOutcomes(f, f) : none(null),
    linkedin ? linkedinActivity(f, f) : none(null),
    linkedin ? linkedinOutcomes(f, f) : none(null),
    email && compare ? emailActivity(f, f.previous) : none(null),
    email && compare ? leadOutcomes(f, f.previous) : none(null),
    linkedin && compare ? linkedinActivity(f, f.previous) : none(null),
    linkedin && compare ? linkedinOutcomes(f, f.previous) : none(null),
    getTrendSeries(f, { grain, periods }),
    linkedin ? linkedinOutcomes(f, trendRange, bucket(grain, LI_REPLY_AT)) : none([]),
    listCampaigns(f, { show: 'current', platform: PLATFORM[view] || null }),
    email ? emailActivity(f, f, sdrKey('c')) : none([]),
    email ? leadOutcomes(f, f, sdrKey('l')) : none([]),
    linkedin ? linkedinActivity(f, f, sdrKey('c')) : none([]),
    linkedin ? linkedinOutcomes(f, f, sdrKey('l')) : none([]),
    recentReplies(f, { limit: 20, from: f.from, toExclusive: f.toExclusive, channel: view }),
  ]);
  const meetings = await meetingsAtCompanies(companies);

  const emailNumbers = email ? emailCard(emailNow, emailRepliesNow) : null;
  const linkedinNumbers = linkedin ? linkedinCard(linkedinNow, linkedinRepliesNow) : null;

  const linkedinByPeriod = new Map(linkedinTrend.map(r => [r.key, r]));
  const trendRows = trend.rows.map(row => ({
    ...row,
    linkedinReplied: linkedinByPeriod.get(row.period)?.replied || 0,
    linkedinPositive: linkedinByPeriod.get(row.period)?.positive || 0,
  }));
  // A week or month that has only just begun, with nothing in it yet, would read as a drop to zero.
  const last = trendRows[trendRows.length - 1];
  const running = last && isoDay(nextPeriod(grain, last.period)) > isoDay(new Date());
  if (trendRows.length > 1 && running && TREND_ACTIVITY.every(key => !last[key])) trendRows.pop();

  const sdrs = new Map();
  const sdr = name => {
    if (!sdrs.has(name)) {
      sdrs.set(name, {
        sdr: name, companies: 0, positiveCompanies: 0, emailsSent: 0, peopleEmailed: 0, emailReplied: 0, emailPositive: 0,
        invitesSent: 0, invitesAccepted: 0, messagesSent: 0, linkedinReplied: 0, linkedinPositive: 0,
      });
    }
    return sdrs.get(name);
  };
  for (const r of sdrEmail) Object.assign(sdr(r.key), { emailsSent: r.sent, peopleEmailed: r.leadsContacted });
  for (const r of sdrEmailReplies) Object.assign(sdr(r.key), { emailReplied: r.replied, emailPositive: r.positive });
  for (const r of sdrLinkedin) Object.assign(sdr(r.key), { invitesSent: r.invitesSent, invitesAccepted: r.invitesAccepted, messagesSent: r.messagesSent });
  for (const r of sdrLinkedinReplies) Object.assign(sdr(r.key), { linkedinReplied: r.replied, linkedinPositive: r.positive });
  for (const c of companies) {
    for (const name of c.sdrs.length ? c.sdrs : ['Unattributed']) {
      const row = sdr(name);
      row.companies += 1;
      if (c.positive > 0) row.positiveCompanies += 1;
    }
  }
  const activity = s => s.emailsSent + s.invitesSent + s.messagesSent;
  const bySdr = [...sdrs.values()]
    .filter(s => s.companies || activity(s) || s.emailReplied || s.linkedinReplied)
    .sort((a, b) => b.companies - a.companies || activity(b) - activity(a));

  return {
    program,
    channel: view,
    channels: { email: Boolean(seen?.email), linkedin: Boolean(seen?.linkedin) },
    range: { ...describeRange(f), sinceStart },
    companies,
    companySummary: summarizeCompanies(companies),
    email: emailNumbers,
    linkedin: linkedinNumbers,
    change: compare ? {
      email: email ? changesAgainst(emailNumbers, emailCard(emailPrev, emailRepliesPrev), f.elapsedShare) : null,
      linkedin: linkedin ? changesAgainst(linkedinNumbers, linkedinCard(linkedinPrev, linkedinRepliesPrev), f.elapsedShare) : null,
    } : null,
    trend: trendRows,
    campaigns,
    bySdr,
    meetings,
    replies,
  };
}
