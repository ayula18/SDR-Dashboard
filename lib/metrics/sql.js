/**
 * Every reply, positive and "said no" is counted ONCE, on the day it landed
 * (Ayush, 2026-11-04): replied at the person's first reply, positive and said
 * no at the first reply labelled so (dash_v_leads / dash_v_linkedin_leads).
 * A range therefore holds what came in during it, whenever those people were
 * first reached, and no outcome counts in two ranges. The outcome-event
 * subqueries (core.js, linkedin.js) give each outcome its own row with its date
 * in this column; bucket by it to split outcomes by period.
 *
 * Positives have two sources (Ayush, 2026-11-05): for SDR campaigns the positive
 * response sheet decides, each row one positive on the day it logs; every other
 * campaign keeps our reply labels. sheetOutcomes is the sheet's half.
 */
export const OUTCOME_AT = 'l.outcome_at';

/** Collects bind parameters while a query is built: `${p.add(value)}` → "$3". */
export class Params {
  values = [];

  add(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * The only meetings this dashboard shows: the ones SDR outreach booked (Ayush,
 * 2026-11-05: "only SDR outreaches are important here"). AE, inbound, referral
 * and marketing meetings are never counted, listed or flagged, and neither is
 * one that merely came in after outreach. dash_v_meetings decides `attribution`;
 * every meeting query reads it through here, and scope('meeting') adds it on
 * its own, so no page can forget it.
 *
 * It replaced a second rule in listMeetings (outbound direction or a campaign
 * match), which let AE meetings into the Overview: 31 meetings shown for October
 * against 14 that SDRs booked.
 */
export const OUTREACH_MEETING = alias => `${alias}.attribution = 'sourced'`;

/**
 * How many meetings a set of dash_v_meetings rows is. The view has a row per credited
 * SDR, half a meeting each where the audit sheet splits one between two (formance.com,
 * solo.io), so meetings are summed by share, never counted: count(*) would give the
 * meeting to both SDRs in full and count it twice in a total. `where` narrows it.
 */
export const MEETINGS = (alias, where = null) => `COALESCE(sum(${alias}.share)${where ? ` FILTER (WHERE ${where})` : ''}, 0)::float`;

/** A meeting's channel is the outreach it came from, which the credit decides, not its campaign's platform. */
export const MEETING_CHANNEL_OF_PLATFORM = { instantly: 'email', heyreach: 'linkedin' };

// Our own seeded addresses (dash_internal_domains) never reach here: dash_v_leads,
// dash_v_linkedin_leads and dash_v_meetings drop them, so no filter is needed at
// a query site and none can be forgotten at one.
const SCOPE_COLUMNS = {
  campaign: { excluded: 'excluded', sdr: 'sdr', campaign: 'id' },         // dash_v_campaigns
  lead: { excluded: 'excluded', sdr: 'sdr', campaign: 'campaign_id' },     // dash_v_leads
  meeting: { excluded: null, sdr: 'attributed_sdr', campaign: 'campaign_id', only: OUTREACH_MEETING }, // dash_v_meetings
  linkedin: { excluded: 'excluded', sdr: 'sdr', campaign: 'campaign_id' }, // dash_v_linkedin_leads
  sheet: { excluded: null, sdr: 'sdr', campaign: 'campaign_id' },          // dash_v_sheet_positives
};

/** The dashboard-wide filters (sdr, program, theme, campaign) as a WHERE fragment. */
export function scope(kind, alias, filters, p) {
  const cols = SCOPE_COLUMNS[kind];
  const clauses = [];
  if (cols.excluded) clauses.push(`NOT ${alias}.${cols.excluded}`);
  if (cols.only) clauses.push(cols.only(alias));
  if (filters.sdr) {
    const sdrs = Array.isArray(filters.sdr) ? filters.sdr : [filters.sdr];
    clauses.push(sdrs.length === 1
      ? `${alias}.${cols.sdr} = ${p.add(sdrs[0])}`
      : `${alias}.${cols.sdr} = ANY(${p.add(sdrs)}::text[])`);
  }
  if (filters.program) clauses.push(`${alias}.program = ${p.add(filters.program)}`);
  if (filters.theme) clauses.push(`COALESCE(${alias}.theme, 'Other') = ${p.add(filters.theme)}`);
  if (filters.campaignId) clauses.push(`${alias}.${cols.campaign} = ${p.add(filters.campaignId)}`);
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

/**
 * The positive response sheet as outcome rows for one channel, in the shape of the
 * outcome-event subqueries. Every row is a positive of its own, including someone
 * logged twice months apart, so the person column carries the row's key. A row
 * with no lead also says this person replied, as no lead's reply can.
 * `columns` lists what the caller selects, in its order; anything the view lacks is
 * written there as NULL.
 */
export const sheetOutcomes = (channel, columns) => `
    SELECT ${columns}, e.kind, s.replied_at AS outcome_at
      FROM dash_v_sheet_positives s
     CROSS JOIN LATERAL (VALUES ('positive', TRUE), ('replied', s.lead_id IS NULL)) AS e(kind, hit)
     WHERE s.channel = '${channel}' AND e.hit`;

/**
 * Logged on the sheet at this company by someone we could not tie to a lead: the
 * company still got a positive, though no person on it can show that.
 */
export const SHEET_POSITIVE_AT_COMPANY = domain => `EXISTS (
        SELECT 1 FROM dash_sdr_positives sp
         WHERE sp.company_domain = ${domain} AND sp.lead_id IS NULL AND sp.skip_reason IS NULL AND sp.replied_on IS NOT NULL)`;

/** Period bucket for a date/timestamp column, as 'YYYY-MM-DD' text (weeks start Monday). */
export function bucket(grain, expr) {
  if (!['day', 'week', 'month'].includes(grain)) throw Object.assign(new Error(`Unknown grain "${grain}"`), { status: 400 });
  return `date_trunc('${grain}', ${expr})::date::text`;
}

// Firmographics from the AI SDR `companies` table (alias co). company_type values
// there: Commercially OSS, OSS Affiliated, Non-OSS, Not a Devtool, Review.
export const COMPANY_TYPE = `CASE
  WHEN co.company_type = 'Commercially OSS' THEN 'Open Source'
  WHEN co.company_type = 'OSS Affiliated' THEN 'OSS Affiliated'
  WHEN co.company_type = 'Non-OSS' THEN 'Closed Source'
  WHEN co.company_type = 'Not a Devtool' THEN 'Not a devtool'
  ELSE 'Unknown' END`;

export const EMPLOYEES = 'COALESCE(co.apollo_employees, co.employee_reo, co.crunchbase_employees)';

export const EMPLOYEE_BUCKET = `CASE
  WHEN ${EMPLOYEES} IS NULL THEN 'Unknown'
  WHEN ${EMPLOYEES} <= 10 THEN '1-10'
  WHEN ${EMPLOYEES} <= 25 THEN '11-25'
  WHEN ${EMPLOYEES} <= 50 THEN '26-50'
  WHEN ${EMPLOYEES} <= 100 THEN '51-100'
  WHEN ${EMPLOYEES} <= 200 THEN '101-200'
  WHEN ${EMPLOYEES} <= 500 THEN '201-500'
  ELSE '501+' END`;
