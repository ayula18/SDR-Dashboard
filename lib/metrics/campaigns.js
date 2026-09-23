import { qp } from '../db.js';
import { addDays, isoDay, periodsBetween, today, weekStart } from '../outreach/dates.js';
import { lifetimeLeads, lifetimeMeetings, recentReplies } from './core.js';
import { accountsFor } from './coverage.js';
import { describeRange } from './filters.js';
import { notFound, rate } from './format.js';
import { LI_COMPANY, LI_IS_COMPANY, linkedinCompanies, linkedinPeople } from './linkedin.js';
import { listMeetings } from './meetings.js';
import { Params, scope } from './sql.js';
import { getTrendSeries } from './trends.js';

const SHOW = new Set(['active', 'current', 'running', 'all']);
const n = v => v || 0;

/** How many companies each campaign reached on its channel, and the three with the most people. */
async function companiesByCampaign(ids) {
  if (!ids.length) return new Map();
  const rows = await qp(`
    SELECT campaign_id, count(*)::int AS companies, count(*) FILTER (WHERE matched)::int AS matched,
           (array_agg(label ORDER BY people DESC, label))[1:3] AS top
      FROM (
        SELECT campaign_id, COALESCE(max(company_name), company_domain) AS label, count(*) AS people, TRUE AS matched
          FROM dash_leads
         WHERE campaign_id = ANY($1::text[]) AND company_domain IS NOT NULL
         GROUP BY campaign_id, company_domain
        UNION ALL
        SELECT l.campaign_id, max(l.company_name), count(DISTINCT l.linkedin_id), bool_or(l.company_domain IS NOT NULL)
          FROM dash_v_linkedin_leads l
         WHERE l.campaign_id = ANY($1::text[]) AND ${LI_IS_COMPANY}
         GROUP BY l.campaign_id, ${LI_COMPANY}
      ) per_company
     GROUP BY campaign_id`, [ids]);
  return new Map(rows.map(r => [r.campaign_id, r]));
}

/**
 * Campaigns on both channels, each with activity in the range and results for
 * the whole campaign.
 *   show  active   activity in the range (default)
 *         current  running now, or activity in the range
 *         running  running now
 *         all      every campaign matching the filters
 */
export async function listCampaigns(filters, { show = 'active', includeInactive = false, since = null, search = null, platform = null, limit = 500 } = {}) {
  const mode = includeInactive ? 'all' : SHOW.has(show) ? show : 'active';
  const p = new Params();
  const grain = p.add(filters.grain);
  const periods = p.add(filters.periods);
  const from = p.add(filters.from);
  const to = p.add(filters.toExclusive);

  const where = [scope('campaign', 'c', filters, p)];
  if (platform) where.push(`c.platform = ${p.add(platform)}`);
  if (search) where.push(`c.name ILIKE ${p.add(`%${search}%`)}`);
  if (since) where.push(`c.created_at_src >= ${p.add(since)}`);
  const inRange = '(act.campaign_id IS NOT NULL OR outc.campaign_id IS NOT NULL OR loaded.campaign_id IS NOT NULL)';
  if (mode === 'active') where.push(inRange);
  if (mode === 'current') where.push(`(c.status = 'active' OR ${inRange})`);
  if (mode === 'running') where.push(`c.status = 'active'`);

  const rows = await qp(`
    WITH act AS (
      SELECT campaign_id,
             SUM(sent)::int AS sent, SUM(new_leads_contacted)::int AS leads_contacted,
             SUM(replies_unique)::int AS platform_replies,
             SUM(auto_replies_unique)::int AS auto_replies, SUM(bounced)::int AS bounced,
             SUM(opportunities)::int AS opportunities,
             SUM(connections_sent)::int AS invites_sent, SUM(connections_accepted)::int AS invites_accepted,
             SUM(messages_sent)::int AS messages_sent, SUM(message_replies)::int AS message_replies
        FROM dash_campaign_periods
       WHERE grain = ${grain} AND period_start = ANY(${periods}::date[])
       GROUP BY 1
    ),
    outc AS (
      SELECT campaign_id,
             count(*) FILTER (WHERE replied)::int AS replied,
             count(*) FILTER (WHERE positive)::int AS positive,
             count(*) FILTER (WHERE negative)::int AS negative
        FROM dash_v_leads
       WHERE reply_count > 0 AND last_reply_at >= ${from} AND last_reply_at < ${to}
       GROUP BY 1
    ),
    loaded AS (
      SELECT campaign_id, count(*)::int AS leads_loaded
        FROM dash_leads
       WHERE created_at_src >= ${from} AND created_at_src < ${to}
       GROUP BY 1
    ),
    life AS (
      SELECT campaign_id,
             count(*)::int AS leads, count(DISTINCT company_domain)::int AS accounts,
             count(*) FILTER (WHERE contacted)::int AS contacted,
             count(*) FILTER (WHERE replied)::int AS replied,
             count(*) FILTER (WHERE positive)::int AS positive,
             count(*) FILTER (WHERE negative)::int AS negative,
             min(created_at_src) AS first_loaded_at, max(created_at_src) AS last_loaded_at,
             max(GREATEST(last_contact_at, last_reply_at)) AS last_activity_at
        FROM dash_v_leads
       GROUP BY 1
    ),
    mtg AS (
      SELECT campaign_id, count(*)::int AS meetings,
             count(*) FILTER (WHERE did_happen)::int AS held,
             count(*) FILTER (WHERE qualified)::int AS qualified
        FROM dash_v_meetings
       WHERE campaign_id IS NOT NULL
       GROUP BY 1
    ),
    li AS (
      SELECT l.campaign_id,
             count(DISTINCT l.linkedin_id)::int AS people,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.invited)::int AS invited,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.accepted)::int AS accepted,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.messaged)::int AS messaged,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.reached)::int AS reached,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.replied)::int AS replied,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.replied AND l.messaged)::int AS replied_messaged,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.positive)::int AS positive,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.negative)::int AS negative,
             count(*) FILTER (WHERE l.campaign_status IN ('InSequence', 'Pending'))::int AS in_sequence,
             count(*) FILTER (WHERE l.campaign_status = 'Failed')::int AS failed,
             max(GREATEST(l.added_at, l.last_action_at, l.last_reply_at)) AS last_activity_at
        FROM dash_v_linkedin_leads l
       GROUP BY 1
    ),
    li_mtg AS (
      SELECT x.campaign_id, count(DISTINCT m.id)::int AS meetings,
             count(DISTINCT m.id) FILTER (WHERE lower(m.happened) = 'yes')::int AS held
        FROM (SELECT l.campaign_id, l.company_domain, min(l.added_at)::date AS first_added
                FROM dash_v_linkedin_leads l
               WHERE l.company_domain IS NOT NULL AND NOT l.no_company
               GROUP BY 1, 2) x
        JOIN dash_v_meetings m ON m.company_domain = x.company_domain
         AND m.meeting_date >= x.first_added AND m.meeting_date < x.first_added + 180
       GROUP BY 1
    )
    SELECT c.id, c.platform, c.name, c.status, c.sdr, c.program, COALESCE(c.theme, 'Other') AS theme, c.segment, c.region,
           c.senders, c.created_at_src AS created_at, c.overridden,
           act.sent, act.leads_contacted, act.platform_replies, act.auto_replies, act.bounced, act.opportunities,
           act.invites_sent, act.invites_accepted, act.messages_sent, act.message_replies,
           outc.replied AS period_replied, outc.positive AS period_positive, outc.negative AS period_negative,
           loaded.leads_loaded,
           life.leads, life.accounts, life.contacted, life.replied, life.positive, life.negative,
           life.first_loaded_at, life.last_loaded_at, life.last_activity_at AS email_last_activity_at,
           s.sent AS lifetime_sent, s.bounced AS lifetime_bounced, s.opportunities AS lifetime_opportunities,
           s.connections_sent AS lifetime_invites_sent, s.messages_sent AS lifetime_messages_sent,
           mtg.meetings, mtg.held, mtg.qualified,
           li.people AS li_people, li.invited AS li_invited, li.accepted AS li_accepted, li.messaged AS li_messaged,
           li.reached AS li_reached, li.replied AS li_replied, li.replied_messaged AS li_replied_messaged,
           li.positive AS li_positive, li.negative AS li_negative, li.in_sequence AS li_in_sequence, li.failed AS li_failed,
           li.last_activity_at AS li_last_activity_at, li_mtg.meetings AS li_meetings, li_mtg.held AS li_held
      FROM dash_v_campaigns c
      LEFT JOIN act    ON act.campaign_id = c.id
      LEFT JOIN outc   ON outc.campaign_id = c.id
      LEFT JOIN loaded ON loaded.campaign_id = c.id
      LEFT JOIN life   ON life.campaign_id = c.id
      LEFT JOIN mtg    ON mtg.campaign_id = c.id
      LEFT JOIN li     ON li.campaign_id = c.id
      LEFT JOIN li_mtg ON li_mtg.campaign_id = c.id
      LEFT JOIN dash_campaign_stats s ON s.campaign_id = c.id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(act.sent, 0) + COALESCE(act.messages_sent, 0) + COALESCE(act.invites_sent, 0) DESC, c.created_at_src DESC NULLS LAST
     LIMIT ${p.add(limit)}`, p.values);

  const companies = await companiesByCampaign(rows.map(r => r.id));

  return rows.map(r => {
    const co = companies.get(r.id);
    const linkedin = r.platform === 'heyreach';
    return {
      id: r.id,
      platform: r.platform,
      name: r.name,
      status: r.status,
      sdr: r.sdr,
      program: r.program,
      theme: r.theme,
      segment: r.segment,
      region: r.region,
      senders: r.senders,
      createdAt: r.created_at,
      overridden: r.overridden,
      lastActivityAt: linkedin ? r.li_last_activity_at : r.email_last_activity_at,
      companies: { count: n(co?.companies), matched: n(co?.matched), top: co?.top || [] },
      period: {
        sent: n(r.sent),
        leadsContacted: n(r.leads_contacted),
        leadsLoaded: n(r.leads_loaded),
        replies: n(r.period_replied),
        positive: n(r.period_positive),
        negative: n(r.period_negative),
        platformReplies: n(r.platform_replies),
        autoReplies: n(r.auto_replies),
        bounced: n(r.bounced),
        opportunities: n(r.opportunities),
        linkedinInvitesSent: n(r.invites_sent),
        linkedinInvitesAccepted: n(r.invites_accepted),
        linkedinMessagesSent: n(r.messages_sent),
        linkedinReplies: n(r.message_replies),
        positiveRate: rate(n(r.period_positive), n(r.leads_contacted)),
      },
      lifetime: {
        leads: n(r.leads),
        accounts: n(r.accounts),
        contacted: n(r.contacted),
        replied: n(r.replied),
        positive: n(r.positive),
        negative: n(r.negative),
        sent: n(r.lifetime_sent),
        bounced: n(r.lifetime_bounced),
        opportunities: n(r.lifetime_opportunities),
        linkedinInvitesSent: n(r.lifetime_invites_sent),
        linkedinMessagesSent: n(r.lifetime_messages_sent),
        meetings: n(r.meetings),
        held: n(r.held),
        qualified: n(r.qualified),
        replyRate: rate(n(r.replied), n(r.contacted)),
        positiveRate: rate(n(r.positive), n(r.contacted)),
        bounceRate: rate(n(r.lifetime_bounced), n(r.lifetime_sent)),
        firstLoadedAt: r.first_loaded_at,
        lastLoadedAt: r.last_loaded_at,
      },
      linkedin: linkedin ? {
        people: n(r.li_people),
        invited: n(r.li_invited),
        accepted: n(r.li_accepted),
        messaged: n(r.li_messaged),
        reached: n(r.li_reached),
        replied: n(r.li_replied),
        positive: n(r.li_positive),
        negative: n(r.li_negative),
        inSequence: n(r.li_in_sequence),
        failed: n(r.li_failed),
        meetings: n(r.li_meetings),
        held: n(r.li_held),
        acceptanceRate: rate(n(r.li_accepted), n(r.li_invited)),
        replyRate: rate(n(r.li_replied_messaged), n(r.li_messaged)),
        positiveRate: rate(n(r.li_positive), n(r.li_reached)),
      } : null,
    };
  });
}

export async function getCampaignsPage(filters, options) {
  return { range: describeRange(filters), campaigns: await listCampaigns(filters, options) };
}

async function linkedinCampaignDetail(campaign, scoped, trendPeriods) {
  const [people, companies, senders, trend, replies] = await Promise.all([
    linkedinPeople(scoped),
    linkedinCompanies(scoped),
    linkedinPeople(scoped, { groupBy: `COALESCE(l.sender, 'Unknown')` }),
    getTrendSeries(scoped, { grain: 'week', periods: trendPeriods }),
    recentReplies(scoped, { limit: 50 }),
  ]);
  const withMeeting = companies.filter(c => c.meetings > 0);

  return {
    campaign,
    linkedin: {
      ...people,
      meetings: withMeeting.reduce((sum, c) => sum + c.meetings, 0),
      meetingsHeld: withMeeting.reduce((sum, c) => sum + c.meetingsHeld, 0),
      companiesWithMeeting: withMeeting.length,
    },
    peopleFunnel: [
      { key: 'people', label: 'People added', value: people.people },
      { key: 'invited', label: 'Invited', value: people.invited },
      { key: 'accepted', label: 'Accepted', value: people.accepted },
      { key: 'replied', label: 'Replied', value: people.replied },
      { key: 'positive', label: 'Positive', value: people.positive },
    ],
    companyFunnel: [
      { key: 'companies', label: 'Companies', value: people.companies },
      { key: 'reached', label: 'Reached', value: people.companiesReached },
      { key: 'accepted', label: 'Accepted', value: people.companiesAccepted },
      { key: 'replied', label: 'Replied', value: people.companiesReplied },
      { key: 'positive', label: 'Positive', value: people.companiesPositive },
      { key: 'meeting', label: 'With a meeting', value: withMeeting.length },
    ],
    trend: trend.rows,
    companies,
    senders: senders.sort((a, b) => b.people - a.people),
    replies,
  };
}

/** One campaign: lifetime funnel, weekly trend, replies and meetings; steps for email, companies and senders for LinkedIn. */
export async function getCampaignDetail(id, filters) {
  const [campaign] = await qp(`
    SELECT c.id, c.platform, c.external_id, c.name, c.status, c.sdr, c.program, COALESCE(c.theme, 'Other') AS theme,
           c.segment, c.region, c.senders, c.created_at_src AS "createdAt", c.excluded, c.overridden, dc.sequence,
           to_jsonb(s) - 'campaign_id' - 'synced_at' AS stats
      FROM dash_v_campaigns c
      JOIN dash_campaigns dc ON dc.id = c.id
      LEFT JOIN dash_campaign_stats s ON s.campaign_id = c.id
     WHERE c.id = $1`, [id]);
  if (!campaign) throw notFound(`No campaign ${id}`);

  const scoped = { ...filters, sdr: null, program: null, theme: null, campaignId: id };
  const created = campaign.createdAt ? new Date(campaign.createdAt) : addDays(today(), -84);
  const firstWeek = weekStart(created < addDays(today(), -182) ? addDays(today(), -182) : created);
  const trendPeriods = periodsBetween('week', firstWeek, today());
  const withDate = { ...campaign, isoCreated: campaign.createdAt ? isoDay(campaign.createdAt) : null };

  if (campaign.platform === 'heyreach') return linkedinCampaignDetail(withDate, scoped, trendPeriods);

  const [leads, meetingsLife, trend, steps, stepReplies, replies, accounts, meetings] = await Promise.all([
    lifetimeLeads(scoped),
    lifetimeMeetings(scoped),
    getTrendSeries(scoped, { grain: 'week', periods: trendPeriods }),
    qp(`SELECT step + 1 AS step, variant, subject, body_preview AS preview, sent, replies_unique AS replies,
               auto_replies_unique AS "autoReplies", opportunities,
               round(100.0 * replies_unique / NULLIF(sent, 0), 2)::float AS "replyRate"
          FROM dash_campaign_steps WHERE campaign_id = $1 ORDER BY step, variant`, [id]),
    qp(`SELECT replied_step + 1 AS step,
               count(*) FILTER (WHERE replied)::int AS replied,
               count(*) FILTER (WHERE positive)::int AS positive,
               count(*) FILTER (WHERE negative)::int AS negative
          FROM dash_v_leads WHERE campaign_id = $1 AND reply_count > 0 AND replied_step IS NOT NULL
         GROUP BY 1 ORDER BY 1`, [id]),
    recentReplies(scoped, { limit: 50 }),
    accountsFor(scoped, { allTime: true, limit: 500 }),
    listMeetings(scoped, { allTime: true }),
  ]);

  return {
    campaign: withDate,
    funnel: [
      { key: 'leadsLoaded', label: 'Leads loaded', value: leads.leadsLoaded },
      { key: 'leadsContacted', label: 'Contacted', value: leads.leadsContacted },
      { key: 'replied', label: 'Replied', value: leads.replied },
      { key: 'positive', label: 'Positive', value: leads.positive },
      { key: 'meetings', label: 'Meetings', value: meetingsLife.meetings },
      { key: 'held', label: 'Held', value: meetingsLife.held },
      { key: 'qualified', label: 'Qualified', value: meetingsLife.qualified },
    ],
    accountsFunnel: [
      { key: 'accountsLoaded', label: 'Accounts targeted', value: leads.accountsLoaded },
      { key: 'accountsContacted', label: 'Contacted', value: leads.accountsContacted },
      { key: 'accountsReplied', label: 'Replied', value: leads.accountsReplied },
      { key: 'accountsPositive', label: 'Positive', value: leads.accountsPositive },
      { key: 'accountsWithMeeting', label: 'With a meeting', value: meetingsLife.accountsWithMeeting },
    ],
    lifetime: { ...leads, ...meetingsLife, negative: leads.negative },
    trend: trend.rows,
    steps,
    repliesByStep: stepReplies,
    replies,
    accounts,
    meetings,
  };
}
