/**
 * HubSpot deals with the SDR form filled, read-only: a search and two batch reads,
 * which HubSpot only offers as POST. About 20 requests for the whole form.
 */
const BASE = 'https://api.hubapi.com';
const DEAL_PROPERTIES = ['date_of_meeting_sdr_form', 'sdr_owner', 'source_of_meeting', 'dealname', 'createdate'];
const PAGE = 100;
const BETWEEN_CALLS_MS = 150;

export const hubspotConfigured = () => Boolean(process.env.HUBSPOT_ACCESS_TOKEN);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(path, body) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error('HUBSPOT_ACCESS_TOKEN is not set'), { code: 'not_configured' });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt <= 4) {
      await wait(1500 * attempt);
      continue;
    }
    const data = await res.json();
    if (res.status === 403) throw Object.assign(new Error(`HubSpot refused ${path}: ${data.message}`), { code: 'missing_scope' });
    if (!res.ok) throw new Error(`HubSpot ${path}: ${res.status} ${data.message}`);
    await wait(BETWEEN_CALLS_MS);
    return data;
  }
}

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Every deal with the form filled, each with its companies. */
export async function sdrFormDeals() {
  const deals = [];
  let after;
  do {
    const page = await call('/crm/v3/objects/deals/search', {
      filterGroups: [{ filters: [{ propertyName: 'date_of_meeting_sdr_form', operator: 'HAS_PROPERTY' }] }],
      properties: DEAL_PROPERTIES,
      sorts: [{ propertyName: 'date_of_meeting_sdr_form', direction: 'ASCENDING' }],
      limit: PAGE,
      after,
    });
    deals.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);

  const companyIds = new Map();
  for (const ids of chunks(deals.map(d => ({ id: d.id })), PAGE)) {
    const links = await call('/crm/v4/associations/deals/companies/batch/read', { inputs: ids });
    for (const row of links.results) companyIds.set(String(row.from.id), row.to.map(t => String(t.toObjectId)));
  }
  const companies = new Map();
  for (const ids of chunks([...new Set([...companyIds.values()].flat())].map(id => ({ id })), PAGE)) {
    const read = await call('/crm/v3/objects/companies/batch/read', { properties: ['domain', 'website', 'name'], inputs: ids });
    for (const company of read.results) companies.set(String(company.id), company.properties);
  }
  return deals.map(d => ({ ...d, companies: (companyIds.get(String(d.id)) || []).map(id => companies.get(id)).filter(Boolean) }));
}
