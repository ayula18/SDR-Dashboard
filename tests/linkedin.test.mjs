import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { companyStage } from '../lib/metrics/companies.js';
import { LI_COMPANY, LI_IS_COMPANY } from '../lib/metrics/linkedin.js';
import { POSITIVE_VERDICTS, REPLY_RANK, displayCompany } from '../lib/metrics/format.js';
import { companyKey, emailedNameIndex, isNoCompany, nameIndex, resolveCompany } from '../lib/outreach/linkedin.js';
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
  assert.deepEqual(resolve('Stability AI', 'p1'), { domain: 'stability.ai', resolution: 'archive', urlKey: null, candidates: null });
  assert.deepEqual(resolve('Mistral', 'p2'), { domain: 'mistral.ai', resolution: 'name', urlKey: null, candidates: null });
  assert.deepEqual(resolve('Lightricks', 'p3'), { domain: 'lightricks.com', resolution: 'name_emailed', urlKey: null, candidates: null });
});

test('LinkedIn companies: an unsettled or unknown name keeps no domain, and placeholders never borrow one', () => {
  assert.deepEqual(resolve('Cobalt', 'p4'), { domain: null, resolution: 'ambiguous', urlKey: null, candidates: ['cobalt.io', 'cobaltai.com'] });
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

// ─── Company identity (013_dash_company_identity.sql) ──────────────────────────

test('LinkedIn companies: headline text in the employer field is not a company', () => {
  for (const name of [
    'Open to: Interim Executive & Strategy Advisor | Fintech',
    'Open to work',
    'Multiple early stage startups',
    'Startups',
    'Early Stage Startups, Israeli Startups, Fortune 1000',
    'Various clients',
    'Seeking new opportunities',
    'Looking for my next role',
  ]) assert.equal(isNoCompany(name), true, name);

  // Real companies whose names begin with one of those words must survive.
  for (const name of ['Multiplex', 'Variscite', 'Startup Genome', 'Openly', 'Seekr']) {
    assert.equal(isNoCompany(name), false, name);
  }
});

test('LinkedIn companies: a company we email resolves even when the registry has never heard of it', () => {
  const withEmailed = {
    ...lookups,
    byEmailedName: emailedNameIndex([
      { domain: 'quokka.io', name: 'Quokka' },
      { domain: 'armadin.com', name: 'Armadin' },
      // the same name on two domains is ambiguous, so it is left out entirely
      { domain: 'delve.co', name: 'Delve' },
      { domain: 'delve.ai', name: 'Delve' },
    ]),
  };
  const r = (name) => resolveCompany({ companyName: name, linkedinId: null }, withEmailed);

  assert.deepEqual(r('Quokka'), { domain: 'quokka.io', resolution: 'emailed_name', urlKey: null, candidates: null });
  assert.deepEqual(r('Armadin'), { domain: 'armadin.com', resolution: 'emailed_name', urlKey: null, candidates: null });
  assert.deepEqual(r('Delve'), { domain: null, resolution: 'unmatched', urlKey: null, candidates: null });
  // The registry still wins when it has an answer.
  assert.deepEqual(r('Mistral'), { domain: 'mistral.ai', resolution: 'name', urlKey: null, candidates: null });
});

test('company display: a name that is really a domain is not shown as a name', () => {
  // Three alloy domains all arrived carrying the name "alloy.com".
  assert.equal(displayCompany(null, 'alloy.com', 'alloy.co'), 'alloy.co');
  assert.equal(displayCompany(null, 'alloy.com', 'alloy.it'), 'alloy.it');
  // A real name is kept, and an enriched name always wins.
  assert.equal(displayCompany(null, 'Alloy', 'alloy.com'), 'Alloy');
  assert.equal(displayCompany('Alloy Inc', 'alloy.com', 'alloy.com'), 'Alloy Inc');
  assert.equal(displayCompany(null, null, 'tray.io'), 'tray.io');
});

test('views: our own domains and the canonical map are applied where nothing can skip them', () => {
  // Internal rows leave at the view, not at a query site, so a new page cannot forget.
  assert.match(views, /FROM base\s*\n(?:--[^\n]*\n)*WHERE NOT base\.internal;/);
  assert.match(views, /WHERE NOT m\.internal/);
  // Every company key is the canonical domain. The email and meetings sides fold
  // it in live; the LinkedIn side reads it from the column the sync job stamped.
  for (const table of ['dash_company_domains cd']) assert.ok(views.includes(table), table);
  assert.ok(views.includes('COALESCE(cd.canonical_domain, l.company_domain) AS company_domain'));
  assert.ok(views.includes('COALESCE(cd.canonical_domain, dm.company_domain) AS company_domain'));
});

test('the LinkedIn closure is read from a bare column, never recomputed in the view', () => {
  // This is a PERFORMANCE invariant with a correctness-sized blast radius.
  // dash_v_meetings re-runs dash_v_linkedin_leads once per meeting to attribute
  // it. While company_domain was a COALESCE over three LEFT JOINs, nothing could
  // index it, so each of 663 meetings rebuilt 6,271 rows: 64s a query, and the
  // program page died on a statement timeout. Measured after: 3.4s.
  assert.ok(views.includes('l.canonical_domain AS closed_domain'),
    'the view must read the stored column, not rebuild the closure');
  assert.ok(!views.includes('dash_linkedin_company_domains lcd'),
    'the page-closure join belongs in the company-identity job now');
  assert.ok(!views.includes('dash_company_names cn'),
    'the name-closure join belongs in the company-identity job now');

  // And the job must actually do it, or the column is never filled.
  const job = readFileSync(new URL('../lib/sync/jobs/company-identity.js', import.meta.url), 'utf8');
  for (const table of ['dash_linkedin_company_domains lcd', 'dash_company_names cn', 'dash_company_domains cd']) {
    assert.ok(job.includes(table), `company-identity must apply ${table}`);
  }
  assert.match(job, /SET canonical_domain = r\.canonical/);
});

test('views: company_id is built once, in the view, and read everywhere else', () => {
  // The whole point. Eight people at Armadin resolved to armadin.com and a ninth
  // resolved to nothing; a COALESCE at the query site made that ninth person a
  // second company called "Armadin". One definition, in one place, or it recurs.
  assert.ok(views.includes(
    `COALESCE(r.closed_domain, 'name:' || r.company_key, 'li:' || r.company_url) AS company_id`));
  assert.equal(LI_COMPANY, 'l.company_id');
  assert.equal(LI_IS_COMPANY, 'NOT l.no_company AND l.company_id IS NOT NULL');

  // No query site may rebuild it. These are the two that used to, each with a
  // DIFFERENT rule, so one company answered to two keys depending on the page.
  for (const file of ['../lib/metrics/core.js', '../lib/metrics/conversation.js', '../lib/metrics/companies.js',
                      '../lib/metrics/linkedin.js', '../lib/metrics/campaigns.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/'li:'\s*\|\|/.test(src), `${file} rebuilds the company key`);
    assert.ok(!/'name:'\s*\|\|\s*l\.company_key/.test(src), `${file} rebuilds the company key`);
  }
});

test('company date filters bound the same column at both ends', () => {
  // The bug: the lower bound was on last_contact_at and the upper bound on
  // created_at_src, so the predicate had no upper bound on the outreach at all.
  // Every range ending in the past then listed companies contacted AFTER it
  // ended, and one company showed in This week and Last week at once. Measured
  // 2026-10-20: 62 of Last week's 520 companies were never contacted last week.
  const src = readFileSync(new URL('../lib/metrics/companies.js', import.meta.url), 'utf8');
  const bounds = [...src.matchAll(/(emailWhere|linkedinWhere)\.push\(`\$\{(emailAt|linkedinAt)\} (>=|<) \$\{(start|end)\}`\)/g)];
  assert.equal(bounds.length, 4, 'expected one lower and one upper bound per channel');
  for (const [, list, col] of bounds) {
    assert.equal(col, list === 'emailWhere' ? 'emailAt' : 'linkedinAt',
      `${list} must bound its own channel's activity column`);
  }
  // And neither end may reach for a different column.
  assert.ok(!/emailWhere\.push\(`l\.created_at_src [<>]/.test(src));
  assert.ok(!/linkedinWhere\.push\(`l\.added_at [<>]/.test(src));
});

test('a name that is really a domain is not a name, whichever source it came from', () => {
  // The bug this replaces: the guard was applied to the lead name only, so the
  // AI SDR registry — which stores a domain in company_name for 1,271 of its
  // 28,525 rows — rendered "armadin.com" when "Armadin" was sitting right there.
  assert.equal(displayCompany('armadin.com', 'Armadin', 'armadin.com'), 'Armadin');
  assert.equal(displayCompany('hifi.com', 'HIFI', 'hifi.com'), 'HIFI');
  // Both sources useless: the domain is the honest answer.
  assert.equal(displayCompany('alloy.com', 'alloy.com', 'alloy.co'), 'alloy.co');
  // But a company really named after a domain keeps its name, and keeps it over
  // the stale employer one of its people typed. lunar.dev was labelled "Boomi".
  assert.equal(displayCompany('Lunar.dev', 'Boomi', 'lunar.dev'), 'Lunar.dev');
  assert.equal(displayCompany('Checkout.com', 'Evervault', 'checkout.com'), 'Checkout.com');
  assert.equal(displayCompany('SRE.ai', null, 'sre.ai'), 'SRE.ai');
  // No domain either: show whatever we have rather than nothing.
  assert.equal(displayCompany('alloy.com', null, null), 'alloy.com');
});
