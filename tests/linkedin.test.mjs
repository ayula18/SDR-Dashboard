import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { companyStage } from '../lib/metrics/companies.js';
import { POSITIVE_VERDICTS, REPLY_RANK } from '../lib/metrics/format.js';
import { companyKey, isNoCompany, nameIndex, resolveCompany } from '../lib/outreach/linkedin.js';
import { VERDICT_COLUMNS, verdictRow } from '../lib/sync/verdicts.js';

const views = readFileSync(new URL('../db/migrations/900_dash_views.sql', import.meta.url), 'utf8');

const lookups = {
  byName: nameIndex([
    { domain: 'mistral.ai', company_name: 'Mistral AI' },
    { domain: 'lightricks.com', company_name: 'Lightricks' },
    { domain: 'ltx.io', company_name: 'Lightricks' },
    { domain: 'cobalt.io', company_name: 'Cobalt' },
    { domain: 'cobaltai.com', company_name: 'Cobalt AI' },
  ]),
  emailed: new Map([['lightricks.com', 8]]),
  archive: new Map([['p1', 'stability.ai']]),
};
const resolve = (companyName, linkedinId) => resolveCompany({ companyName, linkedinId }, lookups);

test('LinkedIn companies: one company written different ways gets one key', () => {
  assert.equal(companyKey('Mistral AI'), companyKey('Mistral'));
  assert.equal(companyKey('Anaconda, Inc.'), 'anaconda');
  assert.equal(companyKey('Centralize (YC W24)'), 'centralize');
  assert.equal(companyKey('AI21 Labs'), 'ai21');
  assert.equal(companyKey('Vorwerk España'), companyKey('Vorwerk Espana'));
  assert.equal(companyKey('   '), null);
});

test('LinkedIn companies: profile placeholders are not companies', () => {
  for (const name of ['Self-employed', 'Self Employed', 'Stealth AI Startup', 'Freelance', 'Retired']) assert.equal(isNoCompany(name), true, name);
  for (const name of ['Databricks', 'ConfidentialMind', 'Stealthy Labs']) assert.equal(isNoCompany(name), false, name);
});

test('LinkedIn companies: the archive first, then a unique name, then the account email outreach worked', () => {
  assert.deepEqual(resolve('Stability AI', 'p1'), { domain: 'stability.ai', resolution: 'archive', candidates: null });
  assert.deepEqual(resolve('Mistral', 'p2'), { domain: 'mistral.ai', resolution: 'name', candidates: null });
  assert.deepEqual(resolve('Lightricks', 'p3'), { domain: 'lightricks.com', resolution: 'name_emailed', candidates: null });
});

test('LinkedIn companies: an unsettled or unknown name keeps no domain, and placeholders never borrow one', () => {
  assert.deepEqual(resolve('Cobalt', 'p4'), { domain: null, resolution: 'ambiguous', candidates: ['cobalt.io', 'cobaltai.com'] });
  assert.equal(resolve('Key1 Capital', 'p5').resolution, 'unmatched');
  assert.equal(resolve('Self-employed', 'p1').resolution, 'no_company');
  assert.equal(resolve('', 'p1').domain, 'stability.ai');
  assert.equal(resolve(null, 'nobody').resolution, 'no_company');
});

test('views read only dash_* tables, so they can never block a migration in the AI SDR app', () => {
  const sql = views.replace(/--.*$/gm, '');
  const cteNames = new Set([...sql.matchAll(/\b([a-z_]+)\s+AS\s*\(/gi)].map(m => m[1].toLowerCase()));
  const sources = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase());
  assert.ok(sources.length > 5);
  for (const name of sources) assert.ok(name.startsWith('dash_') || cteNames.has(name) || name === 'lateral', `${name} is not a dash_ table`);
});

test('the LinkedIn view ranks best replies in REPLY_RANK order', () => {
  const view = views.slice(views.indexOf('CREATE VIEW dash_v_linkedin_leads'));
  const order = view.match(/array_position\(ARRAY\[([^\]]+)\]/)[1];
  assert.deepEqual([...order.matchAll(/'([a-z_]+)'/g)].map(m => m[1]), REPLY_RANK);
});

test('positive needs a yes or a not now, never just a reply that is not a no', () => {
  const replies = views.slice(views.indexOf('CREATE VIEW dash_v_reply_verdicts'), views.indexOf('CREATE VIEW dash_v_campaigns'));
  const list = replies.match(/IN \(([^)]+)\) AS is_positive/)[1];
  assert.deepEqual([...list.matchAll(/'([a-z_]+)'/g)].map(m => m[1]), POSITIVE_VERDICTS);

  const leads = views.slice(views.indexOf('CREATE VIEW dash_v_leads'), views.indexOf('CREATE VIEW dash_v_meetings'));
  assert.match(leads, /interest_status IN \(1, 2, 3, 4\)/, 'an SDR marking a lead Interested or a meeting in Instantly counts');
  assert.match(leads, /AND base\.positive_signal\)\s+AS positive/);
  const linkedin = views.slice(views.indexOf('CREATE VIEW dash_v_linkedin_leads'));
  assert.match(linkedin, /AND base\.any_positive\)\s+AS positive/);
});

test('company stage: a reply with no clear yes or no is replied; said no only when everyone who replied said no', () => {
  assert.equal(companyStage({ contacted: 6, replied: 1 }), 'replied');
  assert.equal(companyStage({ contacted: 6, replied: 2, negative: 1 }), 'replied');
  assert.equal(companyStage({ contacted: 6, replied: 1, negative: 1 }), 'negative');
  assert.equal(companyStage({ contacted: 6, replied: 2, positive: 1, negative: 1 }), 'positive');
  assert.equal(companyStage({ contacted: 6, replied: 1, meetings: 1 }), 'meeting');
  assert.equal(companyStage({ contacted: 3, connected: 1 }), 'connected');
});

test('a LinkedIn reply keeps its writer in the column the view joins on', () => {
  const row = verdictRow({ id: 'heyreach:1:0', platform: 'linkedin', body: 'Sounds good', linkedinId: 'ACoAAB' });
  assert.equal(row.length, VERDICT_COLUMNS.length);
  assert.equal(row[VERDICT_COLUMNS.indexOf('person_linkedin_id')], 'ACoAAB');
  assert.equal(verdictRow({ id: 'instantly:1', platform: 'email', body: 'No thanks' })[VERDICT_COLUMNS.indexOf('person_linkedin_id')], null);
});
