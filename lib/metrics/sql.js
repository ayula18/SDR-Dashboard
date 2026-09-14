/** Collects bind parameters while a query is built: `${p.add(value)}` → "$3". */
export class Params {
  values = [];

  add(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

const SCOPE_COLUMNS = {
  campaign: { excluded: 'excluded', sdr: 'sdr', campaign: 'id' },         // dash_v_campaigns
  lead: { excluded: 'excluded', sdr: 'sdr', campaign: 'campaign_id' },     // dash_v_leads
  meeting: { excluded: null, sdr: 'attributed_sdr', campaign: 'campaign_id' }, // dash_v_meetings
  linkedin: { excluded: 'excluded', sdr: 'sdr', campaign: 'campaign_id' }, // dash_v_linkedin_leads
};

/** The dashboard-wide filters (sdr, program, theme, campaign) as a WHERE fragment. */
export function scope(kind, alias, filters, p) {
  const cols = SCOPE_COLUMNS[kind];
  const clauses = [];
  if (cols.excluded) clauses.push(`NOT ${alias}.${cols.excluded}`);
  if (filters.sdr) clauses.push(`${alias}.${cols.sdr} = ${p.add(filters.sdr)}`);
  if (filters.program) clauses.push(`${alias}.program = ${p.add(filters.program)}`);
  if (filters.theme) clauses.push(`COALESCE(${alias}.theme, 'Other') = ${p.add(filters.theme)}`);
  if (filters.campaignId) clauses.push(`${alias}.${cols.campaign} = ${p.add(filters.campaignId)}`);
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

/** Period bucket for a date/timestamp column, as 'YYYY-MM-DD' text (weeks start Monday). */
export function bucket(grain, expr) {
  if (grain !== 'week' && grain !== 'month') throw Object.assign(new Error(`Unknown grain "${grain}"`), { status: 400 });
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
