import { qp } from '../db.js';
import { describeRange, trailingPeriods } from './filters.js';
import { rate } from './format.js';
import { COMPANY_TYPE, EMPLOYEES, Params, bucket, scope } from './sql.js';

/**
 * One row per account: who worked it, in which campaigns, how many people were
 * loaded and contacted, what came back, and whether a meeting followed.
 * Range is by load date unless `allTime` or `since` is given.
 */
export async function accountsFor(filters, { allTime = false, since = null, search = null, limit = 300 } = {}) {
  const p = new Params();
  const where = [scope('lead', 'l', filters, p), 'l.company_domain IS NOT NULL'];
  if (since) where.push(`l.created_at_src >= ${p.add(since)}`);
  else if (!allTime) where.push(`l.created_at_src >= ${p.add(filters.from)}`, `l.created_at_src < ${p.add(filters.toExclusive)}`);
  if (search) {
    const s = p.add(`%${search}%`);
    where.push(`(l.company_domain ILIKE ${s} OR l.company_name ILIKE ${s})`);
  }

  const rows = await qp(`
    WITH acc AS (
      SELECT l.company_domain AS domain,
             max(l.company_name) AS lead_company_name,
             array_agg(DISTINCT l.sdr) FILTER (WHERE l.sdr IS NOT NULL) AS sdrs,
             array_agg(DISTINCT l.campaign_name) AS campaigns,
             count(*)::int AS leads,
             count(*) FILTER (WHERE l.contacted)::int AS contacted,
             count(*) FILTER (WHERE l.replied)::int AS replied,
             count(*) FILTER (WHERE l.positive)::int AS positive,
             count(*) FILTER (WHERE l.negative)::int AS negative,
             min(l.created_at_src) AS first_loaded_at,
             max(l.last_contact_at) AS last_contact_at,
             max(l.last_reply_at) FILTER (WHERE l.replied) AS last_reply_at
        FROM dash_v_leads l
       WHERE ${where.join(' AND ')}
       GROUP BY 1
    )
    SELECT acc.*,
           COALESCE(co.company_name, acc.lead_company_name) AS company,
           ${COMPANY_TYPE} AS company_type, ${EMPLOYEES} AS employees,
           co.icp_decision AS icp, co.category,
           mt.meetings, mt.held, mt.qualified, mt.last_meeting
      FROM acc
      LEFT JOIN companies co ON co.domain = acc.domain
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS meetings,
               count(*) FILTER (WHERE lower(dm.happened) = 'yes')::int AS held,
               count(*) FILTER (WHERE dm.qualified)::int AS qualified,
               max(dm.meeting_date)::text AS last_meeting
          FROM dash_meetings dm
         WHERE dm.company_domain = acc.domain AND dm.meeting_date >= acc.first_loaded_at::date
      ) mt ON TRUE
     ORDER BY (mt.meetings > 0) DESC, acc.positive DESC, acc.replied DESC, acc.leads DESC
     LIMIT ${p.add(limit)}`, p.values);

  return rows.map(r => ({
    domain: r.domain,
    company: r.company,
    companyType: r.company_type,
    employees: r.employees,
    icp: r.icp,
    category: r.category,
    sdrs: r.sdrs || [],
    campaigns: r.campaigns || [],
    leads: r.leads,
    contacted: r.contacted,
    replied: r.replied,
    positive: r.positive,
    negative: r.negative,
    firstLoadedAt: r.first_loaded_at,
    lastContactAt: r.last_contact_at,
    lastReplyAt: r.last_reply_at,
    meetings: r.meetings,
    meetingsHeld: r.held,
    qualified: r.qualified,
    lastMeeting: r.last_meeting,
    status: r.meetings > 0 ? 'meeting' : r.positive > 0 ? 'positive' : r.replied > r.negative ? 'replied' : r.negative > 0 ? 'negative' : r.contacted > 0 ? 'contacted' : 'loaded',
  }));
}

/**
 * Allocation and coverage: accounts loaded per week and how far they got, by
 * SDR, and where the same account was loaded again or by two SDRs.
 */
export async function getCoverage(filters, { search = null, limit = 300 } = {}) {
  const trendPeriods = trailingPeriods('week', filters.to, 12);
  const weekly = new Params();
  const bySdr = new Params();
  const repeats = new Params();

  const cohortColumns = `
    count(DISTINCT l.company_domain)::int                             AS "accountsLoaded",
    count(*)::int                                                     AS "leadsLoaded",
    count(*) FILTER (WHERE l.contacted)::int                          AS "leadsContacted",
    count(DISTINCT l.company_domain) FILTER (WHERE l.contacted)::int  AS "accountsContacted",
    count(DISTINCT l.company_domain) FILTER (WHERE l.replied)::int    AS "accountsReplied",
    count(DISTINCT l.company_domain) FILTER (WHERE l.positive)::int   AS "accountsPositive",
    count(DISTINCT l.company_domain) FILTER (WHERE EXISTS (
      SELECT 1 FROM dash_meetings dm
       WHERE dm.company_domain = l.company_domain
         AND dm.meeting_date >= l.created_at_src::date
         AND dm.meeting_date < l.created_at_src::date + 180))::int     AS "accountsWithMeeting"`;

  const [weeks, sdrs, repeated, shared, accounts] = await Promise.all([
    qp(`
      SELECT ${bucket('week', 'l.created_at_src')} AS week, ${cohortColumns}
        FROM dash_v_leads l
       WHERE l.created_at_src >= ${weekly.add(trendPeriods[0])}
         AND ${scope('lead', 'l', filters, weekly)}
       GROUP BY 1 ORDER BY 1`, weekly.values),
    qp(`
      SELECT COALESCE(l.sdr, 'Unattributed') AS sdr, ${cohortColumns}
        FROM dash_v_leads l
       WHERE l.created_at_src >= ${bySdr.add(filters.from)} AND l.created_at_src < ${bySdr.add(filters.toExclusive)}
         AND ${scope('lead', 'l', filters, bySdr)}
       GROUP BY 1 ORDER BY "accountsLoaded" DESC`, bySdr.values),
    // Accounts loaded in the range that had already been loaded more than 30 days earlier.
    qp(`
      WITH cur AS (
        SELECT l.company_domain, min(l.created_at_src) AS first_in_range,
               array_agg(DISTINCT l.sdr) FILTER (WHERE l.sdr IS NOT NULL) AS sdrs
          FROM dash_v_leads l
         WHERE l.company_domain IS NOT NULL
           AND l.created_at_src >= ${repeats.add(filters.from)} AND l.created_at_src < ${repeats.add(filters.toExclusive)}
           AND ${scope('lead', 'l', filters, repeats)}
         GROUP BY 1
      )
      SELECT cur.company_domain AS domain, cur.sdrs, prior.last_loaded_at, prior.prior_sdrs, count(*) OVER ()::int AS total
        FROM cur
        JOIN LATERAL (
          SELECT max(p.created_at_src) AS last_loaded_at, array_agg(DISTINCT p.sdr) FILTER (WHERE p.sdr IS NOT NULL) AS prior_sdrs
            FROM dash_v_leads p
           WHERE p.company_domain = cur.company_domain AND NOT p.excluded
             AND p.created_at_src < cur.first_in_range - INTERVAL '30 days'
        ) prior ON prior.last_loaded_at IS NOT NULL
       ORDER BY prior.last_loaded_at DESC
       LIMIT 200`, repeats.values),
    // Accounts worked by more than one SDR in the range.
    (() => {
      const q = new Params();
      return qp(`
        SELECT l.company_domain AS domain, array_agg(DISTINCT l.sdr) AS sdrs, count(DISTINCT l.campaign_id)::int AS campaigns,
               count(*) OVER ()::int AS total
          FROM dash_v_leads l
         WHERE l.company_domain IS NOT NULL AND l.sdr IS NOT NULL
           AND l.created_at_src >= ${q.add(filters.from)} AND l.created_at_src < ${q.add(filters.toExclusive)}
           AND ${scope('lead', 'l', { ...filters, sdr: null }, q)}
         GROUP BY 1
        HAVING count(DISTINCT l.sdr) > 1
         ORDER BY count(DISTINCT l.sdr) DESC, 1
         LIMIT 200`, q.values);
    })(),
    accountsFor(filters, { search, limit }),
  ]);

  const withRates = r => ({
    ...r,
    contactRate: rate(r.accountsContacted, r.accountsLoaded),
    positiveAccountRate: rate(r.accountsPositive, r.accountsContacted),
    meetingAccountRate: rate(r.accountsWithMeeting, r.accountsContacted),
  });

  return {
    range: describeRange(filters),
    basis: 'Accounts by the week their leads were loaded into Instantly; outcomes whenever they happened.',
    weekly: trendPeriods.map(week => withRates({
      week,
      accountsLoaded: 0, leadsLoaded: 0, leadsContacted: 0, accountsContacted: 0, accountsReplied: 0, accountsPositive: 0, accountsWithMeeting: 0,
      ...weeks.find(w => w.week === week),
    })),
    bySdr: sdrs.map(withRates),
    // The lists stop at 200 rows; the totals don't.
    reloadedTotal: repeated[0]?.total || 0,
    sharedTotal: shared[0]?.total || 0,
    reloadedAccounts: repeated,
    sharedAccounts: shared,
    accounts,
  };
}
