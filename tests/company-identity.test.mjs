import assert from 'node:assert/strict';
import test from 'node:test';
import { corroborate, proposeGroups } from '../lib/outreach/company-groups.js';
import { domainMatchMethod, extractCoreRoot } from '../lib/outreach/domain-match.js';
import { resolveCompany } from '../lib/outreach/linkedin.js';

const row = (domain, company_name, extra = {}) =>
  ({ domain, company_name, company_linkedin_url: null, weight: 1, known: false, ...extra });

test('domain matching: ported from the AI SDR app, so both frontends agree on who is who', () => {
  assert.equal(extractCoreRoot('runalloy.com'), 'alloy');
  assert.equal(extractCoreRoot('getpostman.com'), 'postman');
  assert.equal(extractCoreRoot('trytruffle.ai'), 'truffle');
  // Guards that exist because they were measured as wrong over there.
  assert.equal(domainMatchMethod('box.com', 'dropbox.com'), null);
  assert.equal(domainMatchMethod('usegit.ai', 'gitai.com'), null, 'a 3-letter core root is not evidence');
  assert.equal(domainMatchMethod('splunk.com', 'www.splunk.com'), 'exact');
  assert.equal(domainMatchMethod('alloy.com', 'alloy.it'), 'root');
});

test('grouping: a shared root alone never merges — about half of those are wrong', () => {
  const { confirmed, review } = proposeGroups([
    row('delta.com', 'Delta Air Lines'),
    row('delta.blue', 'DeltaBlue'),
    row('buddy.works', 'Buddy'),
    row('buildbuddy.io', 'BuildBuddy'),
  ]);
  assert.equal(confirmed.length, 0, 'nothing corroborated these');
  assert.deepEqual(review.map(r => r.root).sort(), ['buddy', 'delta']);
});

test('grouping: a second signal confirms — name, subdomain or LinkedIn URL', () => {
  const byName = proposeGroups([
    row('alloy.com', 'alloy.com', { known: true, weight: 8 }),
    row('alloy.co', 'alloy.com'),
    row('alloy.it', 'alloy.com'),
  ]);
  assert.equal(byName.confirmed[0].method, 'name');
  assert.equal(byName.confirmed[0].members[0].domain, 'alloy.com');

  const bySub = proposeGroups([
    row('leaseweb.com', 'Leaseweb', { known: true }),
    row('uk.leaseweb.com', null, { known: true, weight: 99 }),
  ]);
  assert.equal(bySub.confirmed[0].method, 'subdomain');

  const byLi = proposeGroups([
    row('acme.io', 'Acme', { company_linkedin_url: 'https://www.linkedin.com/company/acme' }),
    row('acme.dev', 'Acme Corporation', { company_linkedin_url: 'linkedin.com/company/acme/' }),
  ]);
  assert.equal(byLi.confirmed[0].method, 'linkedin');
});

test('grouping: the apex domain is canonical, not whichever one we emailed most', () => {
  // nl.leaseweb.com had the most outreach and is in the registry; it is still
  // a regional office, and a regional office is not the company.
  const { confirmed } = proposeGroups([
    row('nl.leaseweb.com', 'Leaseweb', { known: true, weight: 500 }),
    row('us.leaseweb.com', 'Leaseweb', { known: true, weight: 400 }),
    row('leaseweb.com', 'Leaseweb', { known: true, weight: 1 }),
  ]);
  assert.equal(confirmed[0].members[0].domain, 'leaseweb.com');
});

test('grouping: a root too short or too generic identifies nobody', () => {
  const { confirmed, review } = proposeGroups([
    row('ac.in', 'IIM'), row('x.ac.in', 'IIT'),
  ]);
  assert.equal(confirmed.length + review.length, 0);
});


const base = {
  archive: new Map(), byName: new Map(), byEmailedName: new Map(),
  byPersonName: new Map(), emailed: new Map(),
  byLinkedinUrl: new Map([['linkedin.com/company/cribl', 'cribl.io']]),
};

test('identity: the company page outranks the enriched email, which is often a former employer', () => {
  // Measured: where the two disagree, the page matches the employer LinkedIn
  // reports now 572 times against the email's 299. Reaching someone on LinkedIn
  // reaches the company they are at today, so the page decides.
  const r = resolveCompany({
    companyName: 'Cribl',
    companyUrl: 'https://www.linkedin.com/company/cribl/',
    workEmail: 'apodracky@meshiq.com',
  }, base);
  assert.equal(r.domain, 'cribl.io');
  assert.equal(r.resolution, 'company_linkedin');
});

test('identity: a work email that contradicts the stated employer is not used', () => {
  // No page answer here, so the email is the only domain on offer — and it
  // disagrees with the employer they claim, which is how people ended up filed
  // under companies they had left.
  const r = resolveCompany({
    companyName: 'Chainguard',
    companyUrl: 'https://www.linkedin.com/company/chainguard',
    workEmail: 'patrick@dynamo.ai',
  }, base);
  assert.equal(r.domain, null);
  assert.equal(r.resolution, 'linkedin_only', 'keyed on the page, not guessed at');

  // The same email DOES answer when it agrees with the employer.
  const ok = resolveCompany({
    companyName: 'Dynamo AI',
    companyUrl: null,
    workEmail: 'patrick@dynamo.ai',
  }, base);
  assert.equal(ok.domain, 'dynamo.ai');
  assert.equal(ok.resolution, 'work_email');
});

test('identity: a placeholder employer is never a company, whatever else we hold', () => {
  const r = resolveCompany({
    companyName: 'Open to work',
    companyUrl: 'https://www.linkedin.com/company/cribl',
    workEmail: 'someone@cribl.io',
  }, base);
  assert.equal(r.resolution, 'no_company');
  assert.equal(r.urlKey, null);
});
