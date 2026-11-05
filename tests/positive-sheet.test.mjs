import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  columnsOf, firstNames, initialFits, matchRow, mergeTabs, monthDay, nameMatches, parseCurrentTab, parseOldTab, placeYear,
  resolveDomain, rowKey, sdrName, skipReason,
} from '../lib/outreach/positive-sheet.js';

const OLD_HEADER = ['Name', 'Next steps', 'Company', 'Followup', 'OSS/Non OSS', 'Domain', 'Muni Comments', 'Neutral/Positive', 'SDR?', 'Platform', 'Email/LI', 'Reply date', 'FU 1', 'Status', 'Next steps', 'Last FU date', 'Comments '];
const oldRow = (name, company, reply, extra = {}) => {
  const cells = Array(OLD_HEADER.length).fill('');
  Object.assign(cells, { 0: name, 2: company, 8: extra.sdr ?? 'Akhil', 9: extra.platform ?? 'LinkedIn', 11: reply, 12: extra.fu1 ?? '', 13: extra.status ?? '', 14: extra.notes ?? '', 7: extra.mark ?? '' });
  return cells;
};
const CURRENT_HEADER = ['Name', 'Domain', 'OSS/Non OSS', 'WS', 'SDR?', 'Platform', 'Email/LI', 'Reply date', 'FU 1', 'FU 2', 'FU 3', 'FU 4', 'FU 5', 'FU 6', 'FU 7', 'Status', 'Context', 'Last FU date', 'Next possible step'];
const currentRow = (name, domain, week, reply, fu1 = '', extra = {}) => {
  const cells = Array(CURRENT_HEADER.length).fill('');
  Object.assign(cells, { 0: name, 1: domain, 3: week, 4: extra.sdr ?? 'Akhil', 5: extra.platform ?? 'Linkedin', 7: reply, 8: fu1, 15: extra.status ?? '', 16: extra.notes ?? '' });
  return cells;
};
const NOW = new Date('2026-11-05T00:00:00Z');

test('a date with no year takes the year its place among the rows allows', () => {
  assert.deepEqual(monthDay('Sept-23'), { month: 8, day: 23 });
  assert.deepEqual(monthDay('Apr 2'), { month: 3, day: 2 });
  assert.equal(monthDay('N/A'), null);
  assert.equal(placeYear(monthDay('Jan-9'), '2025-12-20'), '2026-01-09');
  assert.equal(placeYear(monthDay('Dec-20'), '2026-01-09'), '2025-12-20');
  assert.equal(placeYear(monthDay('Jul-3'), '2024-09-11'), '2024-07-03');
});

test('old tab: rows walk from 2024 into 2026, and a row with no date takes its neighbours\'', () => {
  const rows = parseOldTab([OLD_HEADER,
    oldRow('Jamie', 'Keboola', 'Sep-11'),
    oldRow('Jon', 'Kong', 'Nov-2'),
    oldRow('Nitin', 'Oxylabs', 'Dec-30'),
    oldRow('Mira', 'Bun', 'Jan-7'),
    oldRow('Aki', 'Tyk', 'Feb-5'),
    oldRow('Lou', 'Stream', ''),
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  assert.deepEqual(rows.map(r => r.repliedOn), ['2024-09-11', '2024-11-02', '2024-12-30', '2025-01-07', '2025-02-05', '2025-02-05']);
  assert.equal(rows[5].dateSource, 'position');
});

test('current tab: a reply can come long after its week, but not after its own first follow-up or in the future', () => {
  const [carried, late, typo, unlogged, future] = parseCurrentTab([CURRENT_HEADER,
    currentRow('Julian', 'blueoptima.com', 'Nov-9', 'Nov-12'),
    currentRow('Rony', 'hosted.ai', 'Jul-27', 'Sep-24', 'Sep-24'),
    currentRow('Antoine', 'formance.com', 'Aug-17', 'Nov-26', 'Aug-20'),
    currentRow('Tariq', 'yugabyte.com', 'Oct-8', ''),
    currentRow('Ada', 'neon.tech', 'Oct-26', 'Nov-30'),
  ], NOW);
  assert.equal(carried.repliedOn, '2025-11-12');
  assert.equal(late.repliedOn, '2026-09-24');
  assert.equal(typo.repliedOn, '2026-08-20');
  assert.equal(typo.dateSource, 'followup');
  assert.equal(unlogged.repliedOn, '2026-10-08');
  assert.equal(unlogged.dateSource, 'week');
  assert.equal(future.repliedOn, '2026-10-26');
});

test('a renamed column fails the run instead of filling the wrong field', () => {
  assert.throws(() => columnsOf(['Name', 'Domain'], { name: 'Name', reply: 'Reply date' }, 'Positive responses'), /"Positive responses" has no "Reply date" column/);
  // The old tab has two "Next steps"; only the later one holds what the SDR did.
  assert.equal(columnsOf(['Next steps', 'x', 'Next steps'], { notes: 'Next steps' }, 'tab').notes, 2);
});

test('a row moved to the current tab is one positive; the same person logged again is a new one', () => {
  const old = parseOldTab([OLD_HEADER,
    oldRow('Greg', 'Mux', 'Oct-1'),
    oldRow('Greg', 'Mux', 'Nov-20'),
    oldRow('Casey', 'Realm Security', 'Jun-25', { status: 'Moved to new tracker' }),
    oldRow('Molly', 'Hammerspace', 'Jul-7', { status: 'Moved to new tracker' }),
  ]);
  const current = parseCurrentTab([CURRENT_HEADER,
    currentRow('Molly', 'hammerspace.com', 'Jul-6', 'Jul-7', 'Jul-7', { status: 'Cold' }),
    currentRow('Casey', 'realm.security', 'Jun-22', 'Jun-25', 'Jun-25', { status: 'Booked' }),
  ], NOW);
  const merged = mergeTabs(old, current);
  assert.equal(merged.length, 4);
  const molly = merged.find(r => r.personName === 'Molly');
  assert.equal(molly.tab, 'current');
  assert.equal(molly.status, 'Cold');
  assert.equal(merged.filter(r => r.personName === 'Greg').length, 2);
  assert.equal(new Set(merged.map(rowKey)).size, 4);
});

test('a row counts unless the SDR said otherwise', () => {
  const row = { sdrRaw: 'Akhil', channel: 'email', repliedOn: '2026-08-01' };
  assert.equal(skipReason(row), null);
  assert.equal(skipReason({ ...row, status: 'Unlikely to book', notes: 'sent sample. did not like it' }), null);
  assert.equal(skipReason({ ...row, notes: 'NOT POSITIVE. ok to follow up in Jan' }), 'SDR note says not positive');
  assert.equal(skipReason({ ...row, notes: 'neutral reply (not counted). asked if now is better' }), 'SDR note says not positive');
  assert.equal(skipReason({ ...row, mark: 'Neutral' }), 'marked neutral');
  assert.equal(skipReason({ ...row, mark: 'Positive' }), null);
  assert.equal(skipReason({ ...row, sdrRaw: 'Inbound' }), 'not outreach');
  assert.equal(skipReason({ ...row, sdrRaw: 'Referal' }), 'not outreach');
});

test('credit goes to the name on the team list; a signal or blank is nobody', () => {
  const team = [{ name: 'Harshini', aliases: ['harishni'] }, { name: 'Akash', aliases: [] }];
  assert.equal(sdrName('Harishni', team), 'Harshini');
  assert.equal(sdrName('Akash(?)', team), 'Akash');
  assert.equal(sdrName('Suman ', team), 'Suman');
  assert.equal(sdrName('Aaryan', team), 'Aaryan');
  for (const none of ['NA', 'Koala', 'Job Change', '', null]) assert.equal(sdrName(none, team), null);
});

test('one row can name several people, and a domain or a name finds its company', () => {
  assert.deepEqual(firstNames('Toby + George'), ['toby', 'george']);
  assert.deepEqual(firstNames('Esther and Brian'), ['esther', 'brian']);
  assert.deepEqual(firstNames('Jake (Jakub)'), ['jake']);

  const lookups = {
    canonical: new Map([['quiknode.io', 'quicknode.com']]),
    emailedByName: new Map([['tyk', 'tyk.io']]),
    linkedinByName: new Map(),
    outreachRoots: new Map([['spectrocloud', 'spectrocloud.com']]),
    registryByName: new Map([['cobalt', ['cobalt.io', 'cobaltai.com']], ['zilliz', ['zilliz.com']]]),
  };
  const domain = row => resolveDomain(row, lookups);
  assert.equal(domain({ domainRaw: 'quiknode.io' }), 'quicknode.com');
  assert.equal(domain({ companyName: 'Tyk' }), 'tyk.io');
  assert.equal(domain({ companyName: 'Multiversecomputing.com' }), 'multiversecomputing.com');
  assert.equal(domain({ companyName: 'Spectro Cloud' }), 'spectrocloud.com');
  assert.equal(domain({ companyName: 'Zilliz' }), 'zilliz.com');
  assert.equal(domain({ companyName: 'Cobalt' }), null, 'two companies answer to it, so it is not guessed');
  assert.equal(domain({ domainRaw: 'reversinglabs' }), null);
});

test('names on an address or a profile: typos are forgiven, other people are not', () => {
  assert.equal(nameMatches('loana', { name: 'Ioana Dragan' }), true);
  assert.equal(nameMatches('brad', { name: 'R. Brad Kirn' }), true);
  assert.equal(nameMatches('steve', { email: 'steveba@jfrog.com' }), true);
  assert.equal(nameMatches('jesse', { email: 'jesse.h@tavus.io' }), true);
  assert.equal(nameMatches('scott', { email: 'pam.bragan@acquia.com' }), false);
  assert.equal(nameMatches('phil', { email: 'pbarkett@blockstream.com' }), false);
  assert.equal(initialFits('phil', { email: 'pbarkett@blockstream.com' }), true);
  assert.equal(initialFits('kirsten', { email: 'kfoon@influxdata.com' }), true);
  assert.equal(initialFits('scott', { email: 'pam.bragan@acquia.com' }), false);
  assert.equal(initialFits('craig', { name: 'Leopold Samsinger' }), false);
});

test('a row is tied to a person, and credit needs a campaign the SDRs own that had reached them by then', () => {
  const lead = { channel: 'email', email: 'jesse@tavus.io', leadId: 'l1', campaignId: 'c1', sdr: 'Akhil', fromSheet: true, excluded: false, touchedOn: '2026-05-01', replyDates: ['2026-06-27'] };
  const row = { personName: 'Jesse', channel: 'email', sdr: 'Akhil', repliedOn: '2026-06-27', companyDomain: 'tavus.io' };
  const match = people => matchRow(row, () => people);

  assert.deepEqual(match([lead]), { matchKind: 'person', personEmail: 'jesse@tavus.io', linkedinId: null, campaignId: 'c1', leadId: 'l1' });

  // Their words still show, but an AI SDR campaign's lead takes no credit for what an SDR logged.
  const agents = match([{ ...lead, fromSheet: false }]);
  assert.equal(agents.personEmail, 'jesse@tavus.io');
  assert.equal(agents.campaignId, null);
  assert.equal(match([{ ...lead, excluded: true }]).campaignId, null);

  // A campaign that first reached them after the reply cannot be what produced it.
  const later = match([{ ...lead, touchedOn: '2026-10-01' }]);
  assert.equal(later.matchKind, 'person');
  assert.equal(later.campaignId, null);

  // The SDR the sheet names wins between two campaigns.
  const two = match([{ ...lead, leadId: 'l2', campaignId: 'c2', sdr: 'Rama' }, lead]);
  assert.equal(two.campaignId, 'c1');
});

test('tiers: a hidden name, another channel, only the company, or nothing; the row counts in every case', () => {
  const row = { personName: 'Kirsten', channel: 'email', sdr: 'Akhil', repliedOn: '2026-10-15', companyDomain: 'influxdata.com' };
  const hidden = { channel: 'email', email: 'kfoon@influxdata.com', leadId: 'l1', campaignId: 'c1', sdr: 'Akhil', fromSheet: true, touchedOn: '2026-09-01', replyDates: ['2026-10-15'] };
  assert.equal(matchRow(row, () => [hidden]).matchKind, 'company_reply');
  assert.equal(matchRow(row, () => [hidden]).leadId, 'l1');

  // Someone else replying that week is not who the SDR logged.
  const other = { ...hidden, email: 'mike.hughes@influxdata.com' };
  const noOne = matchRow(row, () => [other]);
  assert.equal(noOne.matchKind, 'company');
  assert.equal(noOne.personEmail, null);

  const linkedin = { channel: 'linkedin', name: 'Kirsten Foon', linkedinId: 'p1', leadId: 'x', campaignId: 'c9', fromSheet: true, replyDates: [] };
  const elsewhere = matchRow(row, () => [linkedin]);
  assert.equal(elsewhere.matchKind, 'other_channel');
  assert.equal(elsewhere.linkedinId, 'p1');
  assert.equal(elsewhere.campaignId, null);

  assert.equal(matchRow({ ...row, companyDomain: null }, () => []).matchKind, 'none');
});

const views = readFileSync(new URL('../db/migrations/900_dash_views.sql', import.meta.url), 'utf8');
const metric = name => readFileSync(new URL(`../lib/metrics/${name}`, import.meta.url), 'utf8');

test('one rule decides: SDR campaigns read the sheet in both people views, everything else the labels', () => {
  assert.match(views, /COALESCE\(t\.logs_positives, FALSE\) AS positives_from_sheet/);
  const whens = views.match(/CASE WHEN base\.positives_from_sheet THEN base\.on_sheet/g) || [];
  assert.equal(whens.length, 2, 'dash_v_leads and dash_v_linkedin_leads');
  for (const name of ['core.js', 'linkedin.js']) {
    assert.match(metric(name), /AND NOT l0\.positives_from_sheet/, `${name} takes label positives only outside SDR campaigns`);
    assert.match(metric(name), /sheetOutcomes\('/, `${name} takes SDR positives from the sheet`);
  }
});

test('only the view says which sheet rows count', () => {
  const dir = new URL('../lib/metrics/', import.meta.url);
  for (const file of readdirSync(dir)) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    if (text.includes('FROM dash_sdr_positives')) {
      assert.equal(file, 'sql.js', `${file} reads the table directly; use dash_v_sheet_positives`);
      assert.match(text, /sp\.skip_reason IS NULL AND sp\.replied_on IS NOT NULL/);
    }
  }
});
