import { qp } from '../db.js';
import { REPLY_RANK, displayCompany } from './format.js';
import { LI_COMPANY, LI_IS_COMPANY } from './linkedin.js';
import { COMPANY_TYPE, EMPLOYEES, Params, scope } from './sql.js';

// Best first, matching the stage badges: a company that said no ranks below one still in play.
const STAGE_RANK = { meeting: 7, positive: 6, replied: 5, connected: 4, contacted: 3, negative: 2, loaded: 1 };
const rankOf = verdict => (REPLY_RANK.includes(verdict) ? REPLY_RANK.indexOf(verdict) : REPLY_RANK.length);
const time = value => (value ? new Date(value).getTime() : 0);
const n = value => value || 0;

/**
 * The furthest a company got on either channel. A reply that is neither a yes nor a no
 * (no clear intent, or the wrong person) makes it "replied"; "negative" means everyone
 * who replied said no.
 */
export function companyStage({ meetings = 0, replied = 0, positive = 0, negative = 0, connected = 0, contacted = 0 }) {
  if (meetings > 0) return 'meeting';
  if (positive > 0) return 'positive';
  if (replied > negative) return 'replied';
  if (replied > 0) return 'negative';
  if (connected > 0) return 'connected';
  if (contacted > 0) return 'contacted';
  return 'loaded';
}

/**
 * The CTEs every company query is built on: email leads and LinkedIn people per
 * company, merged into one row each, then enriched with the meetings held there
 * since the first touch.
 *
 * Touched means an email lead loaded before the range ended and last emailed
 * after it began, or a LinkedIn person added before it ended whom HeyReach last
 * invited or messaged after it began. `channel` (both | email | linkedin) keeps
 * one channel's outreach only.
 */
function companyCtes(filters, { from = null, toExclusive = null, channel = 'both' }, p) {
  const rank = p.add(REPLY_RANK);
  const emailWhere = [scope('lead', 'l', filters, p), 'l.company_domain IS NOT NULL', 'l.contacted'];
  const linkedinWhere = [scope('linkedin', 'l', filters, p), LI_IS_COMPANY, 'l.reached'];
  if (from) {
    const start = p.add(from);
    emailWhere.push(`l.last_contact_at >= ${start}`);
    linkedinWhere.push(`COALESCE(l.last_action_at, l.added_at) >= ${start}`);
  }
  if (toExclusive) {
    const end = p.add(toExclusive);
    emailWhere.push(`l.created_at_src < ${end}`);
    linkedinWhere.push(`l.added_at < ${end}`);
  }
  if (channel === 'linkedin') emailWhere.push('FALSE');
  if (channel === 'email') linkedinWhere.push('FALSE');

  return `
    email AS (
      SELECT l.company_domain AS company, max(l.company_name) AS name,
             array_agg(DISTINCT l.sdr) FILTER (WHERE l.sdr IS NOT NULL) AS sdrs,
             count(DISTINCT l.campaign_id)::int AS campaigns,
             count(DISTINCT l.email)::int AS people,
             count(DISTINCT l.email) FILTER (WHERE l.replied)::int AS replied,
             count(DISTINCT l.email) FILTER (WHERE l.positive)::int AS positive,
             count(DISTINCT l.email) FILTER (WHERE l.negative)::int AS negative,
             min(l.created_at_src) AS first_at,
             max(GREATEST(l.created_at_src, l.last_contact_at, l.last_reply_at)) AS last_at
        FROM dash_v_leads l
       WHERE ${emailWhere.join(' AND ')}
       GROUP BY 1
    ),
    -- A replied lead's replies come to their latest no, or else their best reply; a company's
    -- best reply is the best of its leads'. Only leads counted as replied take part, so it
    -- always agrees with the reply counts beside it.
    email_person AS (
      SELECT l.company_domain AS company, l.id,
             COALESCE((array_agg(v.verdict ORDER BY v.replied_at DESC) FILTER (WHERE v.is_negative))[1],
                      (array_agg(v.verdict ORDER BY array_position(${rank}::text[], v.verdict)))[1]) AS verdict
        FROM dash_v_leads l
        JOIN dash_v_campaigns c ON c.id = l.campaign_id
        JOIN dash_v_reply_verdicts v
          ON v.platform = 'email' AND v.campaign_external_id = c.external_id AND v.person_email = l.email AND NOT v.is_auto
       WHERE l.replied AND ${emailWhere.join(' AND ')}
       GROUP BY 1, 2
    ),
    email_best AS (
      SELECT company, (array_agg(verdict ORDER BY array_position(${rank}::text[], verdict)))[1] AS verdict
        FROM email_person
       GROUP BY 1
    ),
    li AS (
      SELECT ${LI_COMPANY} AS company, max(l.company_domain) AS domain, max(l.company_name) AS name,
             array_agg(DISTINCT l.sdr) FILTER (WHERE l.sdr IS NOT NULL) AS sdrs,
             count(DISTINCT l.campaign_id)::int AS campaigns,
             count(DISTINCT l.linkedin_id)::int AS people,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.invited)::int AS invited,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.accepted)::int AS accepted,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.messaged)::int AS messaged,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.replied)::int AS replied,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.positive)::int AS positive,
             count(DISTINCT l.linkedin_id) FILTER (WHERE l.negative)::int AS negative,
             (array_agg(l.best_verdict ORDER BY array_position(${rank}::text[], l.best_verdict))
                FILTER (WHERE l.best_verdict IS NOT NULL))[1] AS verdict,
             min(l.added_at) AS first_at,
             max(GREATEST(l.added_at, l.last_action_at, l.last_reply_at)) AS last_at
        FROM dash_v_linkedin_leads l
       WHERE ${linkedinWhere.join(' AND ')}
       GROUP BY 1
    ),
    merged AS (
      SELECT COALESCE(e.company, li.company) AS company,
             COALESCE(e.company, li.domain) AS domain,
             COALESCE(li.name, e.name) AS lead_name,
             e.sdrs AS e_sdrs, e.campaigns AS e_campaigns, e.people AS e_people,
             e.replied AS e_replied, e.positive AS e_positive, e.negative AS e_negative, eb.verdict AS e_verdict,
             li.sdrs AS l_sdrs, li.campaigns AS l_campaigns, li.people AS l_people, li.invited AS l_invited,
             li.accepted AS l_accepted, li.messaged AS l_messaged, li.replied AS l_replied,
             li.positive AS l_positive, li.negative AS l_negative, li.verdict AS l_verdict,
             LEAST(e.first_at, li.first_at) AS first_at,
             GREATEST(e.last_at, li.last_at) AS last_at
        FROM email e
        LEFT JOIN email_best eb ON eb.company = e.company
        FULL JOIN li ON li.company = e.company
    ),
    enriched AS (
      SELECT m.*, mt.meetings, mt.held, mt.qualified, mt.pipeline
        FROM merged m
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS meetings,
                 count(*) FILTER (WHERE lower(dm.happened) = 'yes')::int AS held,
                 count(*) FILTER (WHERE dm.qualified)::int AS qualified,
                 COALESCE(SUM(dm.deal_value) FILTER (WHERE dm.qualified), 0)::float AS pipeline
            FROM dash_v_meetings dm
           WHERE dm.company_domain = m.domain AND dm.meeting_date >= m.first_at::date
             AND NOT dm.rescheduled
        ) mt ON TRUE
    )`;
}

// The firmographics and display name a company row carries, from the AI SDR `companies` table.
const COMPANY_ROW = `m.*, co.company_name AS matched_name, ${COMPANY_TYPE} AS company_type, ${EMPLOYEES} AS employees,
           co.icp_decision AS icp, co.category`;

/** One row from the company query, in the shape every page reads. */
function toCompany(r) {
  const email = r.e_people ? {
    campaigns: r.e_campaigns, people: r.e_people, contacted: r.e_people,
    replied: n(r.e_replied), positive: n(r.e_positive), negative: n(r.e_negative),
  } : null;
  const linkedin = r.l_people ? {
    campaigns: r.l_campaigns, people: r.l_people, invited: n(r.l_invited), accepted: n(r.l_accepted),
    messaged: n(r.l_messaged), replied: n(r.l_replied), positive: n(r.l_positive), negative: n(r.l_negative),
  } : null;
  const replied = n(email?.replied) + n(linkedin?.replied);
  const positive = n(email?.positive) + n(linkedin?.positive);
  const negative = n(email?.negative) + n(linkedin?.negative);
  return {
    key: r.company,
    domain: r.domain,
    company: displayCompany(r.matched_name, r.lead_name, r.domain),
    channels: email && linkedin ? 'both' : email ? 'email' : 'linkedin',
    stage: companyStage({
      meetings: n(r.meetings), replied, positive, negative, connected: n(linkedin?.accepted),
      contacted: n(email?.people) + n(linkedin?.invited) + n(linkedin?.messaged),
    }),
    sdrs: [...new Set([...(r.e_sdrs || []), ...(r.l_sdrs || [])])],
    email,
    linkedin,
    people: n(email?.people) + n(linkedin?.people),
    replied,
    positive,
    negative,
    bestVerdict: [r.e_verdict, r.l_verdict].filter(Boolean).sort((a, b) => rankOf(a) - rankOf(b))[0] || null,
    meetings: n(r.meetings),
    meetingsHeld: n(r.held),
    qualified: n(r.qualified),
    pipeline: n(r.pipeline),
    companyType: r.company_type,
    employees: r.employees,
    icp: r.icp,
    category: r.category,
    firstTouchAt: r.first_at,
    lastTouchAt: r.last_at,
  };
}

const byStage = (a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || time(b.lastTouchAt) - time(a.lastTouchAt);

/**
 * One row per company the filtered outreach touched between `from` and
 * `toExclusive`, with everything that has come of it since: email leads and
 * LinkedIn people side by side, the best reply on either, and meetings after the
 * first touch. A company LinkedIn could not match to a domain is listed by its
 * LinkedIn name.
 */
export async function companiesAcrossChannels(filters, { from = null, toExclusive = null, channel = 'both', limit = 5000 } = {}) {
  const p = new Params();
  const ctes = companyCtes(filters, { from, toExclusive, channel }, p);
  const rows = await qp(`
    WITH ${ctes}
    SELECT ${COMPANY_ROW}
      FROM enriched m
      LEFT JOIN companies co ON co.domain = m.domain
     ORDER BY m.last_at DESC NULLS LAST
     LIMIT ${p.add(limit)}`, p.values);

  return rows.map(toCompany).sort(byStage);
}

// Every company that replied on either channel, or took a meeting: the rows a page can act on.
const REPLIED_OR_MORE = '(COALESCE(m.e_replied, 0) + COALESCE(m.l_replied, 0) > 0 OR COALESCE(m.meetings, 0) > 0)';

const has = column => `COALESCE(${column}, 0) > 0`;
const both = (a, b) => `${has(a)} AND ${has(b)}`;
const only = (a, b) => `${has(a)} AND NOT ${has(b)}`;

/**
 * The same companies as a count, so a range covering thousands of them costs one
 * aggregate instead of thousands of rows: the funnel summary in the shape
 * summarizeCompanies returns, plus the companies that replied or took a meeting.
 *
 * Both come out of one query, because the CTE behind them is the expensive part.
 */
export async function companyPanel(filters, { from = null, toExclusive = null, channel = 'both', limit = 1000, withCompanies = true } = {}) {
  const p = new Params();
  const ctes = companyCtes(filters, { from, toExclusive, channel }, p);
  const list = withCompanies ? `
      (SELECT json_agg(r) FROM (
         SELECT ${COMPANY_ROW}
           FROM enriched m
           LEFT JOIN companies co ON co.domain = m.domain
          WHERE ${REPLIED_OR_MORE}
          ORDER BY COALESCE(m.meetings, 0) DESC,
                   COALESCE(m.e_positive, 0) + COALESCE(m.l_positive, 0) DESC,
                   COALESCE(m.e_replied, 0) + COALESCE(m.l_replied, 0) DESC,
                   m.last_at DESC NULLS LAST
          LIMIT ${p.add(limit)}
       ) r) AS companies,` : '';
  const [row] = await qp(`
    WITH ${ctes}
    SELECT${list}
      count(*)::int                                                               AS total,
      count(*) FILTER (WHERE ${both('m.e_people', 'm.l_people')})::int            AS "both",
      count(*) FILTER (WHERE ${only('m.e_people', 'm.l_people')})::int            AS "emailOnly",
      count(*) FILTER (WHERE ${only('m.l_people', 'm.e_people')})::int            AS "linkedinOnly",
      count(*) FILTER (WHERE COALESCE(m.e_replied, 0) + COALESCE(m.l_replied, 0) > 0)::int   AS replied,
      count(*) FILTER (WHERE COALESCE(m.e_positive, 0) + COALESCE(m.l_positive, 0) > 0)::int AS positive,
      count(*) FILTER (WHERE ${has('m.meetings')})::int                           AS "withMeeting",
      count(*) FILTER (WHERE m.domain IS NULL)::int                               AS "withoutDomain",
      COALESCE(SUM(m.meetings), 0)::int                                           AS meetings,
      COALESCE(SUM(m.held), 0)::int                                               AS held,
      COALESCE(SUM(m.qualified), 0)::int                                          AS qualified,
      COALESCE(SUM(m.pipeline), 0)::float                                         AS pipeline,
      count(*) FILTER (WHERE ${has('m.e_people')})::int                           AS "emailTouched",
      count(*) FILTER (WHERE ${has('m.e_replied')})::int                          AS "emailReplied",
      count(*) FILTER (WHERE ${has('m.e_positive')})::int                         AS "emailPositive",
      count(*) FILTER (WHERE ${has('m.l_people')})::int                           AS "linkedinTouched",
      count(*) FILTER (WHERE ${has('m.l_replied')})::int                          AS "linkedinReplied",
      count(*) FILTER (WHERE ${has('m.l_positive')})::int                         AS "linkedinPositive",
      count(*) FILTER (WHERE ${both('m.e_replied', 'm.l_replied')})::int          AS "repliedBoth",
      count(*) FILTER (WHERE ${only('m.e_replied', 'm.l_replied')})::int          AS "repliedEmailOnly",
      count(*) FILTER (WHERE ${only('m.l_replied', 'm.e_replied')})::int          AS "repliedLinkedinOnly",
      count(*) FILTER (WHERE ${both('m.e_positive', 'm.l_positive')})::int        AS "positiveBoth",
      count(*) FILTER (WHERE ${only('m.e_positive', 'm.l_positive')})::int        AS "positiveEmailOnly",
      count(*) FILTER (WHERE ${only('m.l_positive', 'm.e_positive')})::int        AS "positiveLinkedinOnly"
      FROM enriched m`, p.values);

  const companies = (row.companies || []).map(toCompany).sort(byStage);
  return {
    companies,
    // Every company that replied or took a meeting is listed, up to `limit`; the rest are a count only.
    capped: withCompanies && companies.length >= limit,
    summary: {
      total: row.total,
      both: row.both,
      emailOnly: row.emailOnly,
      linkedinOnly: row.linkedinOnly,
      replied: row.replied,
      positive: row.positive,
      withMeeting: row.withMeeting,
      meetings: row.meetings,
      held: row.held,
      qualified: row.qualified,
      pipeline: row.pipeline,
      withoutDomain: row.withoutDomain,
      email: { touched: row.emailTouched, replied: row.emailReplied, positive: row.emailPositive },
      linkedin: { touched: row.linkedinTouched, replied: row.linkedinReplied, positive: row.linkedinPositive },
      split: {
        touched: { emailOnly: row.emailOnly, linkedinOnly: row.linkedinOnly, both: row.both },
        replied: { emailOnly: row.repliedEmailOnly, linkedinOnly: row.repliedLinkedinOnly, both: row.repliedBoth },
        positive: { emailOnly: row.positiveEmailOnly, linkedinOnly: row.positiveLinkedinOnly, both: row.positiveBoth },
      },
    },
  };
}

/** The company funnel for a list from companiesAcrossChannels, overall and per channel. */
export function summarizeCompanies(companies) {
  const count = test => companies.filter(test).length;
  const sum = key => companies.reduce((total, c) => total + (c[key] || 0), 0);
  const perChannel = channel => ({
    touched: count(c => c[channel]),
    replied: count(c => c[channel]?.replied > 0),
    positive: count(c => c[channel]?.positive > 0),
  });
  // The same steps split so the parts add up to the step: a company on both channels counts once, under both.
  const split = hit => ({
    emailOnly: count(c => hit(c.email) && !hit(c.linkedin)),
    linkedinOnly: count(c => hit(c.linkedin) && !hit(c.email)),
    both: count(c => hit(c.email) && hit(c.linkedin)),
  });
  return {
    total: companies.length,
    both: count(c => c.channels === 'both'),
    emailOnly: count(c => c.channels === 'email'),
    linkedinOnly: count(c => c.channels === 'linkedin'),
    replied: count(c => c.replied > 0),
    positive: count(c => c.positive > 0),
    withMeeting: count(c => c.meetings > 0),
    meetings: sum('meetings'),
    held: sum('meetingsHeld'),
    qualified: sum('qualified'),
    pipeline: sum('pipeline'),
    withoutDomain: count(c => !c.domain),
    email: perChannel('email'),
    linkedin: perChannel('linkedin'),
    split: {
      touched: split(channel => Boolean(channel)),
      replied: split(channel => channel?.replied > 0),
      positive: split(channel => channel?.positive > 0),
    },
  };
}
