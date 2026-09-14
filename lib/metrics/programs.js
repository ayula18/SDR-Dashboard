import { qp } from '../db.js';
import { emailActivity, leadOutcomes, lifetimeLeads, lifetimeMeetings, lifetimePlatform, linkedinActivity, meetingTotals, recentReplies } from './core.js';
import { listCampaigns } from './campaigns.js';
import { companiesAcrossChannels, summarizeCompanies } from './companies.js';
import { dashStartDate, describeRange, trailingPeriods } from './filters.js';
import { MIN_SAMPLE, change, markExtremes, notFound, rate } from './format.js';
import { linkedinPeople } from './linkedin.js';
import { listMeetings } from './meetings.js';
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

/** One program: companies across both channels, campaigns, funnels, trend, SDRs, meetings and recent replies. */
export async function getProgramDetail(slug, filters, { since = dashStartDate() } = {}) {
  const [program] = await qp(`SELECT slug, name, poc_name AS poc, description, match_pattern AS "matchPattern" FROM dash_programs WHERE slug = $1`, [slug]);
  if (!program) throw notFound(`No program ${slug}`);

  const f = { ...filters, program: slug };
  const sdrKey = alias => `COALESCE(${alias}.sdr, 'Unattributed')`;
  const [leads, meetings, platform, trend, campaigns, bySdrLeads, bySdrMeetings, bySdrLinkedin, companies, linkedin, meetingList, replies] = await Promise.all([
    lifetimeLeads(f, { since }),
    lifetimeMeetings(f, { since }),
    lifetimePlatform(f, { since }),
    getTrendSeries(f, { grain: filters.trendGrain, periods: trailingPeriods(filters.trendGrain, filters.to, 12) }),
    listCampaigns(f, { show: 'all', since }),
    lifetimeLeads(f, { since, groupBy: sdrKey('l') }),
    lifetimeMeetings(f, { since, groupBy: `COALESCE(m.attributed_sdr, 'Unattributed')` }),
    linkedinPeople(f, { since, groupBy: sdrKey('l') }),
    companiesAcrossChannels(f, { since }),
    linkedinPeople(f, { since }),
    listMeetings(f, { since }),
    recentReplies(f, { limit: 40 }),
  ]);

  const sdrNames = [...new Set([...bySdrLeads, ...bySdrLinkedin].map(s => s.key))];
  const bySdr = sdrNames.map(name => {
    const s = bySdrLeads.find(x => x.key === name) || { leadsLoaded: 0, leadsContacted: 0, replied: 0, positive: 0, negative: 0 };
    const m = bySdrMeetings.find(x => x.key === name) || {};
    const li = bySdrLinkedin.find(x => x.key === name) || {};
    return {
      ...s,
      sdr: name,
      meetings: m.meetings || 0,
      held: m.held || 0,
      qualified: m.qualified || 0,
      positiveRate: rate(s.positive, s.leadsContacted),
      lowSample: s.leadsContacted < MIN_SAMPLE,
      linkedinPeople: li.people || 0,
      linkedinInvited: li.invited || 0,
      linkedinAccepted: li.accepted || 0,
      linkedinReplied: li.replied || 0,
      linkedinPositive: li.positive || 0,
    };
  });

  return {
    program,
    since,
    range: describeRange(f),
    companies,
    companySummary: summarizeCompanies(companies),
    funnel: buildFunnel(leads, meetings, platform),
    linkedin,
    trend: trend.rows,
    bySdr: markExtremes(bySdr).sort((a, b) => (b.leadsContacted + b.linkedinInvited) - (a.leadsContacted + a.linkedinInvited)),
    campaigns,
    meetings: meetingList,
    replies,
  };
}
