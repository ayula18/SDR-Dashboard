import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { upsertRows } from '../lib/db.js';
import { LI_IS_COMPANY, LI_UNRESOLVED } from '../lib/metrics/linkedin.js';
import { summarizeCompanies } from '../lib/metrics/companies.js';
import { JOBS, DEFAULT_SEQUENCE } from '../lib/sync/jobs.js';

// Ayush, 2026-11-02: a company is reached by its first email or invite, never by a
// follow-up. Counting by the LAST contact ran weekly counts 18-36% low.

const code = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*(\/\/|--).*$/gm, '');

test('first touch: companies reached in a range are keyed on the first-touch columns', () => {
  const src = code('lib/metrics/companies.js');
  assert.match(src, /const emailAt = 'l\.first_contact_at'/);
  assert.match(src, /const linkedinAt = 'l\.first_touch_at'/);
});

test('first touch: no metrics query bounds a range on the last contact or last action', () => {
  for (const f of readdirSync(new URL('../lib/metrics/', import.meta.url))) {
    const src = code(`lib/metrics/${f}`);
    assert.ok(!/last_contact_at\s*(>=|<)/.test(src), `${f} counts by the last email; use first_contact_at`);
    assert.ok(!/COALESCE\(l\.last_action_at, l\.added_at\)\s*(>=|<)/.test(src), `${f} counts by the last LinkedIn action; use first_touch_at`);
  }
});

test('first touch: defined once in the views, falling back to the last contact', () => {
  const views = code('db/migrations/900_dash_views.sql');
  assert.match(views, /LEAST\(l\.first_contact_at, l\.last_contact_at\) AS first_contact_at/);
  assert.match(views, /AS first_touch_at/);
});

test('first touch: the archive pass runs after the leads sync it corrects', () => {
  assert.ok(JOBS['email-first-touch']);
  assert.deepEqual(JOBS['email-first-touch'].dependsOn, ['instantly-leads']);
  assert.ok(DEFAULT_SEQUENCE.indexOf('email-first-touch') > DEFAULT_SEQUENCE.indexOf('instantly-leads'));
});

test('upsertRows: updateSql replaces the default assignment, so a sync can keep the earliest value', async () => {
  let sql = '';
  await upsertRows('dash_leads', ['id', 'last_contact_at', 'first_contact_at'], [['a', 1, 1]], {
    conflict: ['id'],
    updateSql: { first_contact_at: 'LEAST(dash_leads.first_contact_at, EXCLUDED.first_contact_at)' },
    client: { query: q => { sql = q.text; return { rows: [] }; } },
  });
  assert.match(sql, /last_contact_at = EXCLUDED\.last_contact_at/);
  assert.match(sql, /first_contact_at = LEAST\(dash_leads\.first_contact_at, EXCLUDED\.first_contact_at\)/);
});

test('linkedin: only a person whose employer resolved to a domain counts toward a company', () => {
  assert.match(LI_IS_COMPANY, /company_domain IS NOT NULL/);
  assert.match(LI_UNRESOLVED, /company_domain IS NULL/);
  // Nothing may count LinkedIn companies by the name-or-page key alone again.
  for (const f of ['companies.js', 'linkedin.js', 'campaigns.js']) {
    assert.ok(!/company_id IS NOT NULL/.test(code(`lib/metrics/${f}`)), `${f} rebuilds the company test; use LI_IS_COMPANY`);
  }
});

test('linkedin: the funnel summary carries the unresolved people beside it', () => {
  const none = summarizeCompanies([]);
  assert.deepEqual(none.unresolved, { people: 0, employers: 0 });
  assert.equal(none.withoutDomain, undefined);
  assert.deepEqual(summarizeCompanies([], { people: 3, employers: 2 }).unresolved, { people: 3, employers: 2 });
});
