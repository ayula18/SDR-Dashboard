import { qp } from '../db.js';
import { REPLY_RANK, rate } from './format.js';
import { Params, scope } from './sql.js';

/**
 * LinkedIn outreach counted by person and by company (dash_v_linkedin_leads).
 * Someone in several campaigns is one person.
 */

// A LinkedIn company is its domain once matched, otherwise its normalized name.
export const LI_COMPANY = `COALESCE(l.company_domain, 'name:' || l.company_key)`;
export const LI_IS_COMPANY = `NOT l.no_company AND COALESCE(l.company_domain, l.company_key) IS NOT NULL`;

const people = flag => `count(DISTINCT l.linkedin_id) FILTER (WHERE ${flag})::int`;
const companies = flag => `count(DISTINCT ${LI_COMPANY}) FILTER (WHERE ${LI_IS_COMPANY} AND ${flag})::int`;

const withRates = r => ({
  ...r,
  acceptanceRate: rate(r.accepted, r.invited),
  replyRate: rate(r.repliedMessaged, r.messaged),
  positiveRate: rate(r.positive, r.reached),
});

/** When a LinkedIn reply is dated: the archived reply, or HeyReach's last action on the person until it is archived. */
export const LI_REPLY_AT = 'COALESCE(l.last_reply_at, l.last_action_at)';

/** People who replied, dated by their reply, in [range.from, range.toExclusive). `groupBy` is a SQL expression over alias l. */
export async function linkedinOutcomes(filters, range, groupBy = null) {
  const p = new Params();
  const rows = await qp(`
    SELECT ${groupBy ? `${groupBy} AS key,` : ''}
           ${people('l.replied')}  AS replied,
           ${people('l.positive')} AS positive,
           ${people('l.negative')} AS negative
      FROM dash_v_linkedin_leads l
     WHERE l.replied
       AND ${LI_REPLY_AT} >= ${p.add(range.from)} AND ${LI_REPLY_AT} < ${p.add(range.toExclusive)}
       AND ${scope('linkedin', 'l', filters, p)}
     ${groupBy ? 'GROUP BY 1' : ''}`, p.values);
  return groupBy ? rows : rows[0];
}

/** People and companies at each stage. `groupBy` is a SQL expression over alias l, returned as `key`. */
export async function linkedinPeople(filters, { since = null, groupBy = null } = {}) {
  const p = new Params();
  const where = [scope('linkedin', 'l', filters, p)];
  if (since) where.push(`l.added_at >= ${p.add(since)}`);

  const rows = await qp(`
    SELECT ${groupBy ? `${groupBy} AS key,` : ''}
           count(DISTINCT l.linkedin_id)::int                                        AS people,
           ${people('l.invited')}                                                     AS invited,
           ${people('l.accepted')}                                                    AS accepted,
           ${people('l.messaged')}                                                    AS messaged,
           ${people('l.reached')}                                                     AS reached,
           ${people('l.replied')}                                                     AS replied,
           ${people('l.replied AND l.messaged')}                                      AS "repliedMessaged",
           ${people('l.positive')}                                                    AS positive,
           ${people('l.negative')}                                                    AS negative,
           count(*) FILTER (WHERE l.campaign_status IN ('InSequence', 'Pending'))::int AS "inSequence",
           count(*) FILTER (WHERE l.campaign_status = 'Failed')::int                  AS failed,
           ${companies('TRUE')}                                                       AS companies,
           count(DISTINCT l.company_domain) FILTER (WHERE NOT l.no_company)::int     AS "companiesMatched",
           ${companies('l.reached')}                                                  AS "companiesReached",
           ${companies('l.accepted')}                                                 AS "companiesAccepted",
           ${companies('l.replied')}                                                  AS "companiesReplied",
           ${companies('l.positive')}                                                 AS "companiesPositive",
           count(DISTINCT l.campaign_id)::int                                        AS campaigns,
           max(GREATEST(l.added_at, l.last_action_at, l.last_reply_at))              AS "lastActivityAt"
      FROM dash_v_linkedin_leads l
     WHERE ${where.join(' AND ')}
     ${groupBy ? 'GROUP BY 1' : ''}`, p.values);

  return groupBy ? rows.map(withRates) : withRates(rows[0]);
}

/**
 * One row per company the filtered LinkedIn campaigns reached: people at each
 * stage and their titles, the best reply, whether email outreach worked the same
 * company, and meetings there after the first person was added.
 */
export async function linkedinCompanies(filters, { limit = 1000 } = {}) {
  const p = new Params();
  const rank = p.add(REPLY_RANK);
  const rows = await qp(`
    WITH li AS (
      SELECT ${LI_COMPANY} AS company, max(l.company_domain) AS domain, max(l.company_name) AS name,
             bool_or(l.resolution = 'ambiguous') AS ambiguous,
             count(DISTINCT l.linkedin_id)::int AS people,
             ${people('l.invited')} AS invited, ${people('l.accepted')} AS accepted, ${people('l.messaged')} AS messaged,
             ${people('l.replied')} AS replied, ${people('l.positive')} AS positive, ${people('l.negative')} AS negative,
             (array_agg(l.best_verdict ORDER BY array_position(${rank}::text[], l.best_verdict))
                FILTER (WHERE l.best_verdict IS NOT NULL))[1] AS best_verdict,
             (array_agg(DISTINCT l.position) FILTER (WHERE l.position IS NOT NULL))[1:3] AS titles,
             min(l.added_at) AS first_added_at,
             max(GREATEST(l.added_at, l.last_action_at, l.last_reply_at)) AS last_activity_at
        FROM dash_v_linkedin_leads l
       WHERE ${scope('linkedin', 'l', filters, p)} AND ${LI_IS_COMPANY}
       GROUP BY 1
    )
    SELECT li.*, co.company_name AS matched_name, em.people AS email_people, em.campaigns AS email_campaigns, mt.meetings, mt.held
      FROM li
      LEFT JOIN companies co ON co.domain = li.domain
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS people, count(DISTINCT e.campaign_id)::int AS campaigns
          FROM dash_leads e
          JOIN dash_v_campaigns c ON c.id = e.campaign_id AND NOT c.excluded
         WHERE e.company_domain = li.domain
      ) em ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS meetings, count(*) FILTER (WHERE lower(m.happened) = 'yes')::int AS held
          FROM dash_meetings m
         WHERE m.company_domain = li.domain
           AND m.meeting_date >= li.first_added_at::date AND m.meeting_date < li.first_added_at::date + 180
      ) mt ON TRUE
     ORDER BY (mt.meetings > 0) DESC, li.positive DESC, li.replied DESC, li.accepted DESC, li.people DESC
     LIMIT ${p.add(limit)}`, p.values);

  return rows.map(r => ({
    key: r.company,
    domain: r.domain,
    company: r.matched_name || r.name || r.domain,
    linkedinName: r.name,
    ambiguous: Boolean(r.ambiguous && !r.domain),
    titles: r.titles || [],
    people: r.people,
    invited: r.invited,
    accepted: r.accepted,
    messaged: r.messaged,
    replied: r.replied,
    positive: r.positive,
    negative: r.negative,
    acceptanceRate: rate(r.accepted, r.invited),
    bestVerdict: r.best_verdict,
    emailPeople: r.email_people || 0,
    emailCampaigns: r.email_campaigns || 0,
    meetings: r.meetings || 0,
    meetingsHeld: r.held || 0,
    firstAddedAt: r.first_added_at,
    lastActivityAt: r.last_activity_at,
  }));
}
