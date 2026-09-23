import { qp } from '../db.js';
import { REPLY_RANK } from './format.js';
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
 * One row per company the filtered outreach touched between `from` and
 * `toExclusive`, with everything that has come of it since: email leads and
 * LinkedIn people side by side, the best reply on either, and meetings after the
 * first touch. A company LinkedIn could not match to a domain is listed by its
 * LinkedIn name.
 *
 * Touched means an email lead loaded before the range ended and last emailed
 * after it began, or a LinkedIn person added before it ended whom HeyReach last
 * invited or messaged after it began. `channel` (both | email | linkedin) keeps
 * one channel's outreach only.
 */
export async function companiesAcrossChannels(filters, { from = null, toExclusive = null, channel = 'both', limit = 5000 } = {}) {
  const p = new Params();
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

  const rows = await qp(`
    WITH email AS (
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
    )
    SELECT m.*, co.company_name AS matched_name, ${COMPANY_TYPE} AS company_type, ${EMPLOYEES} AS employees,
           co.icp_decision AS icp, co.category, mt.meetings, mt.held, mt.qualified, mt.pipeline
      FROM merged m
      LEFT JOIN companies co ON co.domain = m.domain
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS meetings,
               count(*) FILTER (WHERE lower(dm.happened) = 'yes')::int AS held,
               count(*) FILTER (WHERE dm.qualified)::int AS qualified,
               COALESCE(SUM(dm.deal_value) FILTER (WHERE dm.qualified), 0)::float AS pipeline
          FROM dash_v_meetings dm
         WHERE dm.company_domain = m.domain AND dm.meeting_date >= m.first_at::date
      ) mt ON TRUE
     ORDER BY m.last_at DESC NULLS LAST
     LIMIT ${p.add(limit)}`, p.values);

  return rows
    .map(r => {
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
        company: r.matched_name || r.lead_name || r.domain,
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
    })
    .sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || time(b.lastTouchAt) - time(a.lastTouchAt));
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
