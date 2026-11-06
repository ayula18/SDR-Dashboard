import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test, { describe } from 'node:test';
import { POSITIVE_VERDICTS } from '../lib/metrics/format.js';
import { DEFAULT_SEQUENCE } from '../lib/sync/jobs.js';
import {
  bookedPositives, columnsOf, firstNames, initialFits, matchRow, mergeTabs, monthDay, nameMatches, parseCurrentTab, parseOldTab, placeYear,
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

test('old tab: a blank Last FU date reads Dec-30, and must not date the row, though a real Dec-30 reply does', () => {
  const lastFuAt = OLD_HEADER.indexOf('Last FU date');
  const blankFu = oldRow('Heidi', 'Acme', '');
  blankFu[lastFuAt] = 'Dec-30';
  const realFu = oldRow('Zach', 'Bolt', '');
  realFu[lastFuAt] = 'Mar-9';
  const rows = parseOldTab([OLD_HEADER,
    oldRow('Jamie', 'Keboola', 'Sep-11'),
    oldRow('Jon', 'Kong', 'Nov-2'),
    oldRow('Nitin', 'Oxylabs', 'Dec-30'),
    oldRow('Mira', 'Bun', 'Jan-7'),
    oldRow('Aki', 'Tyk', 'Mar-5'),
    blankFu,
    realFu,
  ]);
  assert.deepEqual(rows.slice(2).map(r => [r.personName, r.repliedOn, r.dateSource]), [
    ['Nitin', '2024-12-30', 'reply'],
    ['Mira', '2025-01-07', 'reply'],
    ['Aki', '2025-03-05', 'reply'],
    ['Heidi', '2025-03-05', 'position'],
    ['Zach', '2025-03-09', 'followup'],
  ]);
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
  assert.equal(skipReason({ ...row, notes: 'NEUTRAL. sent agentic sample' }), 'SDR note says not positive');
  assert.equal(skipReason({ ...row, notes: 'Neutral message (added to track)' }), 'SDR note says not positive');
  assert.equal(skipReason({ ...row, status: 'Negative response' }), 'SDR note says not positive');
  assert.equal(skipReason({ ...row, status: 'Not interested' }), null, 'what happened later, not what the reply was');
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
  const lead = { channel: 'email', email: 'jesse@tavus.io', leadId: 'l1', campaignId: 'c1', sdr: 'Akhil', sdrLogs: true, fromSheet: true, excluded: false, touchedOn: '2026-05-01', replyDates: ['2026-06-27'] };
  const row = { personName: 'Jesse', channel: 'email', sdr: 'Akhil', repliedOn: '2026-06-27', companyDomain: 'tavus.io' };
  const match = people => matchRow(row, () => people);

  assert.deepEqual(match([lead]), { matchKind: 'person', personEmail: 'jesse@tavus.io', linkedinId: null, campaignId: 'c1', leadId: 'l1' });

  // Their words still show, but an AI SDR campaign's lead takes no credit for what an SDR logged.
  const agents = match([{ ...lead, sdrLogs: false, fromSheet: false }]);
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

test('while labels decide a program its lead takes the row, or one reply would count twice', () => {
  const logged = { channel: 'linkedin', name: 'Mike Dombrowski', linkedinId: 'p1', leadId: 'l1', campaignId: 'harshini', sdr: 'Harshini', sdrLogs: true, fromSheet: true, excluded: false, touchedOn: '2026-10-19', replyDates: ['2026-10-28'] };
  const huggingface = { ...logged, leadId: 'l2', campaignId: 'dheeraj-hf', sdr: 'Dheeraj', fromSheet: false, labelledPositive: true, touchedOn: '2026-10-20' };
  const row = { personName: 'Mike', channel: 'linkedin', sdr: 'Harshini', repliedOn: '2026-10-28', companyDomain: 'extend.ai' };
  assert.equal(matchRow(row, () => [logged, huggingface]).campaignId, 'dheeraj-hf');

  // Just being in that program is not enough: Edward at Gopher replied to Harshini's campaign in
  // 2026, and a 2025 WVI campaign that also holds him got no reply that was labelled positive.
  assert.equal(matchRow(row, () => [logged, { ...huggingface, labelledPositive: false }]).campaignId, 'harshini');

  // A reply months away is not the one that row logged, so the SDR the sheet names keeps it.
  const months = { ...row, repliedOn: '2026-07-28' };
  const earlier = [{ ...logged, touchedOn: '2026-05-01', replyDates: ['2026-10-28'] }, { ...huggingface, touchedOn: '2026-05-01', replyDates: ['2026-10-28'] }];
  assert.equal(matchRow(months, () => earlier).campaignId, 'harshini');

  // Whoever owns the campaign: Pallav at Emphere, logged by Harshini, labelled in Muni's. Without
  // the credit that one reply would count for Harshini on the sheet and for Muni on our labels.
  const muni = { ...huggingface, campaignId: 'muni-feedy', sdr: 'Muni', sdrLogs: false };
  assert.equal(matchRow(row, () => [muni]).campaignId, 'muni-feedy');
  assert.equal(matchRow(row, () => [{ ...muni, labelledPositive: false }]).campaignId, null);
});

describe('the waterfall: an SDR booking nobody logged is a positive, once', () => {
  const meeting = { domain: 'concordium.com', company: 'Concordium', date: '2026-10-12', sdr: 'Ahmed', campaignSdr: 'Ahmed', campaignId: 'c1', channel: 'email' };
  const tba = { channel: 'email', email: 'tba@concordium.com', leadId: 'l1', campaignId: 'c1', sdr: 'Ahmed', sdrLogs: true, fromSheet: true, excluded: false, touchedOn: '2026-10-08',
    replies: [{ day: '2026-10-09', positive: true, negative: false }] };
  const row = over => ({ personName: 'Theo', companyName: null, domainRaw: 'concordium.com', companyDomain: 'concordium.com', sdr: 'Ahmed', repliedOn: '2026-10-09', skipReason: null, ...over });
  const run = (meetings, rows = [], people = [tba]) => bookedPositives(meetings, rows, () => people);

  test('Concordium: booked the same day, on no sheet row', () => {
    const [b, ...rest] = run([meeting]);
    assert.equal(rest.length, 0);
    assert.deepEqual([b.tab, b.personEmail, b.leadId, b.campaignId, b.sdr, b.channel, b.repliedOn, b.dateSource, b.status],
      ['meeting', 'tba@concordium.com', 'l1', 'c1', 'Ahmed', 'email', '2026-10-09', 'reply', 'Booked']);
    assert.match(b.notes, /12 Oct 2026/);
  });

  test('with no reply we hold it is dated by the meeting and still counts', () => {
    const [b] = run([meeting], [], []);
    assert.deepEqual([b.personName, b.leadId, b.campaignId, b.repliedOn, b.dateSource, b.matchKind], [null, null, 'c1', '2026-10-12', 'meeting', 'company']);
  });

  test('a logged row covers the conversation: before, just after, and under another spelling', () => {
    assert.equal(run([meeting], [row()]).length, 0);
    assert.equal(run([meeting], [row({ repliedOn: '2026-05-01' })]).length, 0, 'within 180 days before');
    assert.equal(run([meeting], [row({ repliedOn: '2026-11-20' })]).length, 0, 'within 60 days after');
    assert.equal(run([meeting], [row({ companyDomain: null, domainRaw: null, companyName: 'Concordium' })]).length, 0);
    assert.equal(run([meeting], [row({ repliedOn: '2025-12-01' })]).length, 1, 'a year-old row is another conversation');
    assert.equal(run([meeting], [row({ skipReason: 'SDR note says not positive' })]).length, 1, 'a row that does not count covers nothing');
  });

  test('the same person logged under another domain of theirs is covered, by the same SDR only', () => {
    const tal = { ...tba, email: 'tal@nanoco.ai', sdr: 'Akhil', replies: [{ day: '2026-07-12', positive: false, negative: false }], touchedOn: '2026-07-01' };
    const nanoco = { ...meeting, domain: 'nanoco.ai', company: 'nanoco.ai', date: '2026-07-29', sdr: 'Akhil' };
    const logged = row({ personName: 'Tal', domainRaw: 'nanoclaw.dev', companyDomain: 'nanoclaw.dev', sdr: 'Akhil', repliedOn: '2026-07-12' });
    assert.equal(run([nanoco], [logged], [tal]).length, 0);
    assert.equal(run([nanoco], [{ ...logged, sdr: 'Rama' }], [tal]).length, 1);
  });

  test('names that only look alike do not cover: Coder is not coderabbit.ai, Rootly is not root.io', () => {
    const coderabbit = { ...meeting, domain: 'coderabbit.ai', company: 'coderabbit.ai' };
    assert.equal(run([coderabbit], [row({ companyDomain: null, domainRaw: null, companyName: 'Coder' })], []).length, 1);
    const spur = { ...meeting, domain: 'tryspur.dev', company: 'tryspur.dev' };
    assert.equal(run([spur], [row({ companyDomain: 'spur.dev', domainRaw: 'Spur.dev' })], []).length, 0, 'Spur.dev is tryspur.dev');
  });

  test('a second call is not a second positive; a much later one is', () => {
    const second = { ...meeting, date: '2026-10-20' };
    assert.equal(run([second, meeting]).length, 1);
    assert.equal(run([meeting, { ...meeting, date: '2027-06-01' }]).length, 2);
  });

  test('where labels decide, a reply they already count is not counted again', () => {
    const labelled = { ...tba, fromSheet: false, labelledPositive: true };
    assert.equal(run([meeting], [], [labelled]).length, 0);
    assert.equal(run([meeting], [], [{ ...labelled, labelledPositive: false }]).length, 1);
  });

  test('credit: the meeting names the SDR, else whoever owns the campaign that got the reply', () => {
    const noName = { ...meeting, sdr: null, campaignSdr: null, campaignId: 'fundraise' };
    assert.deepEqual(run([noName]).map(b => [b.sdr, b.campaignId]), [['Ahmed', 'c1']]);
    assert.deepEqual(run([{ ...meeting, sdr: 'Dheeraj' }]).map(b => b.sdr), ['Dheeraj']);
    assert.equal(run([{ ...noName, campaignId: null, channel: null }], [], []).length, 0, 'no SDR, no campaign, nothing to credit');
  });

  test('credit follows the campaign that got the reply, not the one the meeting guessed', () => {
    const reply = { day: '2026-10-05', positive: true, negative: false, campaign: 'ahmed-ref' };
    const ahmed = { ...tba, email: 'justin@signalwire.com', campaignId: 'ahmed', campaignRef: 'ahmed-ref', sdr: 'Ahmed', replies: [reply] };
    const fundraise = { ...ahmed, campaignId: 'fundraise', campaignRef: 'fundraise-ref', sdr: null };
    const m = { ...meeting, sdr: null, campaignSdr: null, campaignId: 'fundraise', domain: 'signalwire.com' };
    assert.deepEqual(run([m], [], [fundraise, ahmed]).map(b => [b.sdr, b.campaignId]), [['Ahmed', 'ahmed']]);
  });

  test('someone with no lead there still dates the row and shows their words, with no credit', () => {
    const chirag = { channel: 'email', email: 'chirag@otpless.com', name: null, excluded: false, fromSheet: true, replies: [{ day: '2026-10-10', positive: true, negative: false }] };
    const [b] = run([meeting], [], [chirag]);
    assert.deepEqual([b.personEmail, b.repliedOn, b.dateSource, b.leadId, b.campaignId, b.sdr], ['chirag@otpless.com', '2026-10-10', 'reply', null, 'c1', 'Ahmed']);
  });

  test('a person who only said no, or was reached after replying, cannot be who it is credited to', () => {
    assert.equal(run([meeting], [], [{ ...tba, replies: [{ day: '2026-10-09', positive: false, negative: true }] }])[0].personEmail, null);
    assert.equal(run([meeting], [], [{ ...tba, touchedOn: '2026-10-20' }])[0].personEmail, null);
  });

  test('with no reply, the day the form was filled dates it before the meeting does', () => {
    const [b] = run([{ ...meeting, bookedOn: '2026-10-09' }], [], []);
    assert.deepEqual([b.repliedOn, b.dateSource], ['2026-10-09', 'booking']);
  });

  test('the job takes only meetings an SDR booked, and runs after them', () => {
    const job = readFileSync(new URL('../lib/sync/jobs/positive-sheet.js', import.meta.url), 'utf8');
    assert.match(job, /OUTREACH_MEETING\('m'\)/);
    assert.match(job, /NOT m\.rescheduled/);
    assert.ok(DEFAULT_SEQUENCE.indexOf('positive-sheet') > DEFAULT_SEQUENCE.indexOf('meetings-evidence'));
  });
});

test('views drop before anything they read, or re-applying the file fails', () => {
  const dropped = [...views.matchAll(/^DROP VIEW IF EXISTS (\w+);/gm)].map(m => m[1]);
  const bodies = views.split(/^(?=CREATE VIEW )/m).slice(1);
  const created = bodies.map(body => body.match(/^CREATE VIEW (\w+)/)[1]);
  assert.deepEqual([...dropped].sort(), [...created].sort(), 'every view is both dropped and created');
  bodies.forEach((body, i) => {
    for (const other of created) {
      if (other === created[i] || !new RegExp(`\\b${other}\\b`).test(body.replace(/^\s*--.*$/gm, ''))) continue;
      assert.ok(dropped.indexOf(created[i]) < dropped.indexOf(other), `${created[i]} reads ${other}, so it must drop first`);
      assert.ok(created.indexOf(other) < i, `${created[i]} reads ${other}, so it must be created after it`);
    }
  });
});

test('not now is not positive on its own: only a yes is, unless the sheet logged it', () => {
  assert.deepEqual(POSITIVE_VERDICTS, ['interested']);
  assert.match(views, /IN \('interested'\) AS is_positive/);
});

test('every page counts both channels wherever it says Positive, and the rates stay email over email', () => {
  for (const name of ['funnel.js', 'overview.js', 'programs.js', 'trends.js']) {
    assert.match(metric(name), /linkedinOutcomes\(/, `${name} leaves LinkedIn positives out`);
  }
  assert.match(metric('trends.js'), /positiveRate: rate\(o\.positive \|\| 0, e\.leadsContacted \|\| 0\)/);
  assert.match(metric('trends.js'), /allPositive: \(o\.positive \|\| 0\) \+ \(r\.positive \|\| 0\)/);
  assert.match(metric('programs.js'), /\|\| s\.emailPositive \|\| s\.linkedinPositive\)/, 'an SDR credited only by the sheet disappears from By SDR');
});

test('the list picks label rows as the cards do: earliest across campaigns, then the range', () => {
  const list = metric('positives.js');
  assert.ok(list.indexOf('DISTINCT ON (lower(l0.email))') < list.indexOf('l.positive_at >= ${start}'), 'the range must apply after the person is picked');
  assert.match(list, /limit = 1000/);
});

test('tiers: a hidden name, another channel, only the company, or nothing; the row counts in every case', () => {
  const row = { personName: 'Kirsten', channel: 'email', sdr: 'Akhil', repliedOn: '2026-10-15', companyDomain: 'influxdata.com' };
  const hidden = { channel: 'email', email: 'kfoon@influxdata.com', leadId: 'l1', campaignId: 'c1', sdr: 'Akhil', sdrLogs: true, fromSheet: true, touchedOn: '2026-09-01', replyDates: ['2026-10-15'] };
  assert.equal(matchRow(row, () => [hidden]).matchKind, 'company_reply');
  assert.equal(matchRow(row, () => [hidden]).leadId, 'l1');

  // Someone else replying that week is not who the SDR logged.
  const other = { ...hidden, email: 'mike.hughes@influxdata.com' };
  const noOne = matchRow(row, () => [other]);
  assert.equal(noOne.matchKind, 'company');
  assert.equal(noOne.personEmail, null);

  const linkedin = { channel: 'linkedin', name: 'Kirsten Foon', linkedinId: 'p1', leadId: 'x', campaignId: 'c9', sdrLogs: true, fromSheet: true, replyDates: [] };
  const elsewhere = matchRow(row, () => [linkedin]);
  assert.equal(elsewhere.matchKind, 'other_channel');
  assert.equal(elsewhere.linkedinId, 'p1');
  assert.equal(elsewhere.campaignId, null);

  assert.equal(matchRow({ ...row, companyDomain: null }, () => []).matchKind, 'none');
});

const views = readFileSync(new URL('../db/migrations/900_dash_views.sql', import.meta.url), 'utf8');
const metric = name => readFileSync(new URL(`../lib/metrics/${name}`, import.meta.url), 'utf8');

test('one rule decides: SDR campaigns read the sheet in both people views, everything else the labels', () => {
  assert.match(views, /\(COALESCE\(t\.logs_positives, FALSE\) AND NOT COALESCE\(p\.positives_from_labels, FALSE\)\) AS positives_from_sheet/);
  const rule = views.match(/\(base\.on_sheet OR \(NOT base\.positives_from_sheet AND label\.labelled_positive\)\)/g) || [];
  assert.equal(rule.length, 2, 'dash_v_leads and dash_v_linkedin_leads');
  for (const name of ['core.js', 'linkedin.js']) {
    assert.match(metric(name), /l0\.positive AND NOT l0\.on_sheet/, `${name} counts a label only where the sheet did not`);
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
