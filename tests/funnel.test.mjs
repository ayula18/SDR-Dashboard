import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeFunnel, shownSdrs, sumFunnel } from '../lib/metrics/funnel.js';
import { bucket } from '../lib/metrics/sql.js';
import { isoDay, nextPeriod, periodEnd, periodStart, periodsBetween } from '../lib/outreach/dates.js';
import { isEligible, isFresh, periodBuckets } from '../lib/sync/jobs/heyreach.js';
import { periodPlan } from '../lib/sync/jobs/instantly-periods.js';

const empty = { email: [], linkedin: [], emailOutcomeRows: [], linkedinOutcomeRows: [], meetings: [] };

test('a day is a period like a week or a month', () => {
  assert.equal(isoDay(periodStart('day', '2026-11-06')), '2026-11-06');
  assert.equal(isoDay(nextPeriod('day', '2026-11-06')), '2026-11-07');
  assert.equal(isoDay(periodEnd('day', '2026-11-06')), '2026-11-06');
  assert.deepEqual(periodsBetween('day', '2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.match(bucket('day', 'x'), /date_trunc\('day', x\)/);
  assert.throws(() => bucket('year', 'x'), /Unknown grain/);
});

test('every run re-reads the last three days, and a full backfill reads every day after its weeks and months', () => {
  const now = new Date(Date.UTC(2026, 10, 6));
  const incremental = Object.fromEntries(periodPlan('incremental', now, '2026-01-05'));
  assert.deepEqual(incremental.day, ['2026-11-04', '2026-11-05', '2026-11-06']);
  assert.ok(incremental.week.length >= 3);

  const full = periodPlan('full', now, '2026-01-05');
  assert.deepEqual(full.map(([grain]) => grain), ['week', 'month', 'day']);
  assert.equal(full[2][1][0], '2026-01-05');
  assert.equal(full[2][1].length, 306);
});

test('HeyReach days add up to the weeks and months built from them', () => {
  const stat = (connections_sent, connections_accepted) => ({ connections_sent, connections_accepted, messages_sent: 0, message_replies: 0 });
  const days = [
    { date: '2026-10-30', stats: stat(10, 1) }, // Friday, October
    { date: '2026-11-01', stats: stat(2, 0) }, // Sunday: same week, next month
    { date: '2026-11-02', stats: stat(7, 3) }, // Monday: next week
    { date: '2026-11-03', stats: stat(0, 0) }, // nothing happened: no row
  ];
  const buckets = new Map(periodBuckets(days));
  const total = (grain, name) => [...buckets].filter(([k]) => k.startsWith(`${grain}|`)).reduce((n, [, b]) => n + b[name], 0);
  for (const name of ['connections_sent', 'connections_accepted']) {
    assert.equal(total('day', name), total('week', name));
    assert.equal(total('day', name), total('month', name));
  }
  assert.equal(buckets.get('day|2026-10-30').connections_sent, 10);
  assert.equal(buckets.get('week|2026-10-26').connections_sent, 12);
  assert.equal(buckets.get('month|2026-11-01').connections_sent, 9);
  assert.equal(buckets.has('day|2026-11-03'), false);
});

test('which HeyReach campaigns get read: a long campaign that finished still gets its last numbers', () => {
  const now = Date.UTC(2026, 10, 6, 18);
  const hours = n => now - n * 3_600_000;
  const days = n => hours(n * 24);
  const incremental = { mode: 'incremental', now };
  const oldFinished = { status: 'FINISHED', creationTime: '2026-07-23' };
  const withDays = { lastWeek: '2026-10-12', lastDay: '2026-10-16' };

  // Harshini_Suman_Starting23/07: created in July, last sent in October, never read again.
  assert.equal(isEligible(oldFinished, { ...incremental, activity: withDays }), true);
  assert.equal(isFresh(oldFinished, { ...incremental, activity: withDays, readAt: days(8) }), false, 'read over a week ago: read again');
  assert.equal(isFresh(oldFinished, { ...incremental, activity: withDays, readAt: days(2) }), true, 'weekly is enough once it has settled');

  const longGone = { lastWeek: '2026-08-03', lastDay: '2026-08-05' };
  assert.equal(isEligible(oldFinished, { ...incremental, activity: longGone }), false, 'finished months ago: left alone');
  assert.equal(isEligible({ status: 'DRAFT', creationTime: '2026-11-01' }, incremental), false);
  assert.equal(isEligible({ status: 'FINISHED', creationTime: '2026-11-01' }, incremental), true, 'new: read even with no numbers yet');

  // Weeks with no days: stored before days were. One read, however fresh, and however old the campaign.
  const noDays = { lastWeek: '2026-03-02', lastDay: null };
  assert.equal(isEligible(oldFinished, { ...incremental, activity: noDays }), true);
  assert.equal(isFresh(oldFinished, { ...incremental, activity: noDays, readAt: hours(1) }), false);

  const running = { status: 'IN_PROGRESS', creationTime: '2026-07-23' };
  const today = { lastWeek: '2026-11-02', lastDay: '2026-11-06' };
  assert.equal(isFresh(running, { ...incremental, activity: today, readAt: hours(3) }), true, 'read today and under 12 hours ago');
  assert.equal(isFresh(running, { ...incremental, activity: today, readAt: hours(13) }), false, 'over 12 hours ago');
  assert.equal(isFresh(running, { ...incremental, activity: today, readAt: hours(19) }), false, 'read before midnight: yesterday is not whole yet');

  // Stopped yesterday: treated as running until it settles, so its last day is whole.
  const stopped = { lastWeek: '2026-11-02', lastDay: '2026-11-05' };
  assert.equal(isFresh(oldFinished, { ...incremental, activity: stopped, readAt: hours(20) }), false);
  assert.equal(isFresh(oldFinished, { ...incremental, activity: stopped, readAt: hours(3) }), true);

  assert.equal(isFresh(running, { mode: 'full', now, activity: today, readAt: hours(1) }), false, 'full re-reads everything');
  assert.equal(isFresh(running, { ...incremental, activity: today }), false, 'never read');
});

test('one row per period and SDR, with both email counts and each meeting on its campaign\'s channel', () => {
  const rows = mergeFunnel({
    ...empty,
    grain: 'week',
    periods: ['2026-10-26'],
    email: [{ key: '2026-10-26|Akhil', sent: 40, allSent: 90 }, { key: '2026-10-19|Akhil', sent: 5, allSent: 5 }],
    linkedin: [{ key: '2026-10-26|', invitesSent: 11, invitesAccepted: 2, messagesSent: 1 }],
    emailOutcomeRows: [{ key: '2026-10-26|Akhil', replied: 3, positive: 1 }],
    linkedinOutcomeRows: [{ key: '2026-10-26|Akhil', replied: 2, positive: 2 }],
    meetings: [
      { date: '2026-10-28', sdr: 'Akhil', platform: 'instantly' },
      { date: '2026-10-29', sdr: 'Akhil', platform: 'heyreach' },
      { date: '2026-10-30', sdr: 'Akhil', platform: null },
      { date: '2026-10-30', sdr: null, platform: 'instantly' },
    ],
  });
  const akhil = rows.find(r => r.sdr === 'Akhil');
  assert.equal(akhil.emailsSent, 90);
  assert.equal(akhil.firstEmails, 40, 'the week outside the periods is dropped');
  assert.equal(akhil.emailPositive, 1);
  assert.equal(akhil.linkedinPositive, 2);
  assert.equal(akhil.emailMeetings, 1);
  assert.equal(akhil.linkedinMeetings, 1);
  assert.equal(akhil.unplacedMeetings, 1, 'a meeting with no campaign is neither channel\'s');
  const nobody = rows.find(r => r.sdr === '');
  assert.equal(nobody.invitesSent, 11);
  assert.equal(nobody.emailMeetings, 1, 'a campaign with no SDR still counts for everyone');
});

test('days add up to the same funnel as the week they fall in', () => {
  const week = { grain: 'week', periods: ['2026-10-26'] };
  const days = { grain: 'day', periods: ['2026-10-26', '2026-10-27'] };
  const meetings = [{ date: '2026-10-26', sdr: 'Rama', platform: 'heyreach' }, { date: '2026-10-27', sdr: 'Rama', platform: 'heyreach' }];
  const byWeek = sumFunnel(mergeFunnel({ ...empty, ...week, meetings, emailOutcomeRows: [{ key: '2026-10-26|Rama', replied: 3, positive: 2 }] }));
  const byDay = sumFunnel(mergeFunnel({
    ...empty,
    ...days,
    meetings,
    emailOutcomeRows: [{ key: '2026-10-26|Rama', replied: 1, positive: 2 }, { key: '2026-10-27|Rama', replied: 2, positive: 0 }],
  }));
  assert.deepEqual(byDay, byWeek);
});

test('an SDR list shows the six until someone is picked by name, and then exactly them', () => {
  const team = [
    { name: 'Akhil', role: 'sdr' }, { name: 'Rama', role: 'sdr' },
    { name: 'Sanika', role: 'sdr_extra' }, { name: 'Aarsh', role: 'sdr_extra' },
    { name: 'Muskan', role: 'other' },
  ];
  const names = picked => shownSdrs(team, picked).map(t => t.name);
  assert.deepEqual(names(null), ['Akhil', 'Rama']);
  assert.deepEqual(names(['Sanika']), ['Sanika']);
  assert.deepEqual(names(['Rama', 'Aarsh']), ['Rama', 'Aarsh']);
});

test('the people an SDR list leaves out can still be picked in the filter', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(read('db/migrations/030_dash_six_sdrs.sql'), /role = 'sdr_extra'/);
  assert.match(read('lib/metrics/meta.js'), /t\.role === 'sdr_extra'/);
  assert.match(read('lib/admin.js'), /sdr_extra/);
  assert.match(read('lib/metrics/dashboard.js'), /shownSdrs\(team, f\.sdr\)/);
});

test('every reader of the periods table says which grain, or days would count twice', () => {
  for (const file of ['lib/metrics/core.js', 'lib/metrics/campaigns.js', 'lib/metrics/insights.js', 'lib/metrics/meta.js', 'lib/sync/jobs/instantly-leads.js', 'lib/sync/jobs/instantly-steps.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const { index } of source.matchAll(/FROM dash_campaign_periods/g)) {
      assert.match(source.slice(index, index + 400), /grain\s*=/, `${file} reads the periods table without a grain`);
    }
  }
});

test('the SDR page and the Overview read one source, and the old leaderboard is gone', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(read('lib/metrics/sdrs.js'), /getLeaderboard/);
  assert.match(read('components/views/SdrsView.js'), /\/api\/metrics\/funnel/);
  assert.match(read('components/views/funnel.js'), /\/api\/metrics\/funnel/);
  assert.doesNotMatch(read('components/views/OverviewView.js'), /ProgramTrend/);
  assert.doesNotMatch(read('components/views/overview.js'), /BarChart/);
  assert.doesNotMatch(read('components/views/OverviewView.js'), /MeetingsPanel|Companies that came back/, 'Ayush removed both on 2026-11-07');
});

test('every percentage on the rate cards prints its formula', () => {
  const program = readFileSync(new URL('../components/views/program.js', import.meta.url), 'utf8');
  const card = program.slice(program.indexOf('export function ChannelRatesCard'), program.indexOf('export function ChannelCards'));
  for (const name of ['formulaAcceptance', 'formulaPositiveEmail', 'formulaPositiveLinkedin', 'formulaMeetingEmail', 'formulaMeetingLinkedin']) {
    assert.match(card, new RegExp(`DEFS\\.${name}`));
  }
  assert.match(card, /\{s\.formula\}/);
});
