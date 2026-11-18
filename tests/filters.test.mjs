import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Params, scope } from '../lib/metrics/sql.js';
import { fullPeriods, parseFilters, periodColumns, resolveRange, trailingPeriods } from '../lib/metrics/filters.js';
import { isoDay, isoWeek, periodLabel, weekStart } from '../lib/outreach/dates.js';

const THU_10_SEP = new Date(Date.UTC(2026, 8, 10));

test('weeks start on Monday and carry ISO week numbers', () => {
  assert.equal(isoDay(weekStart('2026-09-06')), '2026-08-31');
  assert.equal(isoDay(weekStart('2026-09-07')), '2026-09-07');
  assert.equal(isoWeek('2026-01-05'), 2);
  assert.equal(periodLabel('week', '2026-08-31'), 'W36 · 31 Aug');
  assert.equal(periodLabel('month', '2026-08-01'), 'Aug 2026');
});

test('last-4-weeks includes the running week and compares like-for-like days', () => {
  const r = resolveRange('last-4-weeks', null, null, THU_10_SEP);
  assert.deepEqual(r.periods, ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']);
  assert.equal(r.from, '2026-08-17');
  assert.equal(r.to, '2026-09-10');
  assert.equal(r.partial, true);
  assert.equal(Math.round(r.elapsedShare * 100), 89); // 25 of 28 days
  assert.deepEqual(r.previous.periods, ['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10']);
  assert.equal(r.previous.from, '2026-07-20');
  assert.equal(r.previous.to, '2026-08-13');
});

test('last-month is whole and compares with the month before', () => {
  const r = resolveRange('last-month', null, null, THU_10_SEP);
  assert.equal(r.grain, 'month');
  assert.deepEqual(r.periods, ['2026-08-01']);
  assert.equal(r.to, '2026-08-31');
  assert.equal(r.partial, false);
  assert.equal(r.previous.from, '2026-07-01');
  assert.equal(r.previous.to, '2026-07-31');
});

test('a running month never compares past the end of a shorter previous month', () => {
  const r = resolveRange('this-month', null, null, new Date(Date.UTC(2026, 2, 30)));
  assert.equal(r.partial, true);
  assert.equal(r.previous.from, '2026-02-01');
  assert.equal(r.previous.to, '2026-02-28');
});

test('a custom range is exactly the days picked, compared with the same number of days before', () => {
  const days = resolveRange('custom', '2026-08-19', '2026-08-21', THU_10_SEP);
  assert.equal(days.grain, 'day');
  assert.deepEqual(days.periods, ['2026-08-19', '2026-08-20', '2026-08-21']);
  assert.equal(days.from, '2026-08-19');
  assert.equal(days.to, '2026-08-21');
  assert.equal(days.toExclusive, '2026-08-22');
  assert.equal(days.partial, false);
  assert.equal(days.previous.from, '2026-08-16');
  assert.equal(days.previous.to, '2026-08-18');

  assert.throws(() => resolveRange('custom', '2026-08-10', '2026-08-01', THU_10_SEP), /before/);
  assert.throws(() => resolveRange('custom', '2024-01-01', '2026-08-01', THU_10_SEP), /two years/);
});

test('yesterday is one whole day against the day before', () => {
  const r = resolveRange('yesterday', null, null, THU_10_SEP);
  assert.deepEqual(r.periods, ['2026-09-09']);
  assert.equal(r.toExclusive, '2026-09-10');
  assert.equal(r.partial, false);
  assert.equal(r.previous.from, '2026-09-08');
});

test('a program since its start still counts in whole periods', () => {
  const r = resolveRange('since-start', '2026-08-19', null, THU_10_SEP);
  assert.equal(r.grain, 'week');
  assert.equal(r.from, '2026-08-17');
});

test('day, week and month comparisons use last full periods only', () => {
  // Thursday 10 Sep: the week and the month are still running.
  assert.deepEqual(fullPeriods('day', 2, THU_10_SEP), ['2026-09-08', '2026-09-09']);
  assert.deepEqual(fullPeriods('week', 2, THU_10_SEP), ['2026-08-24', '2026-08-31']);
  assert.deepEqual(fullPeriods('month', 2, THU_10_SEP), ['2026-07-01', '2026-08-01']);
});

test('day on day counts every day, weekends too, and a period ends the moment the next one starts', () => {
  // Ayush, 2026-11-18: "DOD should ideally include saturday and dundays too. so that we have accurate data coming in".
  const monday = new Date(Date.UTC(2026, 8, 7));
  assert.deepEqual(fullPeriods('day', 2, monday), ['2026-09-05', '2026-09-06'], 'Monday compares Sunday with Saturday');
  assert.deepEqual(fullPeriods('day', 2, new Date(Date.UTC(2026, 8, 8))), ['2026-09-06', '2026-09-07'], 'Tuesday compares Monday with Sunday');
  assert.deepEqual(fullPeriods('day', 3, new Date(Date.UTC(2026, 8, 6))), ['2026-09-03', '2026-09-04', '2026-09-05'], 'Sunday ends with Saturday');
  assert.deepEqual(fullPeriods('week', 1, monday), ['2026-08-31']);
  assert.deepEqual(fullPeriods('month', 1, new Date(Date.UTC(2026, 8, 1))), ['2026-08-01']);
});

test('trailing periods end with the period containing the date', () => {
  assert.deepEqual(trailingPeriods('week', '2026-09-10', 3), ['2026-08-24', '2026-08-31', '2026-09-07']);
  assert.deepEqual(trailingPeriods('month', '2026-09-10', 2), ['2026-08-01', '2026-09-01']);
});

test('filters: several SDRs can be picked at once, and duplicates collapse', () => {
  assert.deepEqual(parseFilters(new URLSearchParams('sdr=Akhil, Dheeraj,Akhil')).sdr, ['Akhil', 'Dheeraj']);
  assert.equal(parseFilters(new URLSearchParams('sdr=')).sdr, null);
  assert.equal(parseFilters(new URLSearchParams('sdr=all')).sdr, null);
});

test('filters: one SDR filters by equality, several by list', () => {
  const one = new Params();
  assert.match(scope('campaign', 'c', { sdr: ['Akhil'] }, one), /c\.sdr = \$1$/);
  assert.deepEqual(one.values, ['Akhil']);

  const many = new Params();
  assert.match(scope('campaign', 'c', { sdr: ['Akhil', 'Dheeraj'] }, many), /c\.sdr = ANY\(\$1::text\[\]\)$/);
  assert.deepEqual(many.values, [['Akhil', 'Dheeraj']]);
});

test('year to date compares against the same window last year, not the months before January', () => {
  // A ten-month YTD used to take "the previous period of the same length", which
  // is March–December of last year: the wrong part of the calendar, carrying a
  // December it should not and missing a January it should. Measured 2026-10-22,
  // that understated leads at +208% when year on year was +275%.
  const r = resolveRange('ytd', null, null, new Date(Date.UTC(2026, 9, 22)));
  assert.equal(r.grain, 'month');
  assert.equal(r.from, '2026-01-01');
  assert.equal(r.periods.length, 10);
  assert.equal(r.previous.from, '2025-01-01');
  // Still clipped to the same day of the year, so a part-finished year is not
  // compared with a whole one.
  assert.equal(r.previous.toExclusive, r.toExclusive.replace('2026', '2025'));
  assert.equal(r.comparesToLastYear, true);
});

test('every other preset still compares with the period immediately before it', () => {
  const now = new Date(Date.UTC(2026, 9, 22));
  for (const preset of ['this-week', 'last-week', 'last-4-weeks', 'last-12-weeks', 'this-month', 'last-month', 'last-3-months']) {
    const r = resolveRange(preset, null, null, now);
    assert.equal(r.comparesToLastYear, false, preset);
    assert.ok(r.previous.toExclusive <= r.from, `${preset}: previous must end before the range starts`);
  }
  // A custom range is not calendar-anchored either.
  assert.equal(resolveRange('custom', '2026-01-01', '2026-03-31', now).comparesToLastYear, false);
});

// The SDR page's DoD / WoW / MoM columns (Ayush, 2026-11-17).
const TUE_17_NOV = new Date(Date.UTC(2026, 10, 17));
const JULY = { from: '2026-07-01', to: '2026-07-31' };
const brief = cols => cols.map(c => `${c.kind} ${c.from}..${c.to}`);

test('with no dates picked the columns are the last full periods, then the running one of that view only', () => {
  const cols = periodColumns('month', { count: 2, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true });
  assert.deepEqual(brief(cols), [
    'full 2026-09-01..2026-09-30', 'full 2026-10-01..2026-10-31', 'mtd 2026-11-01..2026-11-17',
  ], 'MoM gets November as MTD ("in MOM there is not nov"), and no WTD');
  assert.deepEqual(brief(periodColumns('week', { count: 1, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true })), [
    'full 2026-11-09..2026-11-15', 'wtd 2026-11-16..2026-11-17',
  ], 'WoW ends with WTD only (Ayush: "only show WOW to date if that is selected")');
  assert.deepEqual(periodColumns('week', { count: 3, asOf: TUE_17_NOV }).map(c => c.period), fullPeriods('week', 3, TUE_17_NOV),
    'without toDate it is exactly the full periods the Overview compares');
});

test("a range picked in July gives July's days, weeks and month, and no WTD or MTD", () => {
  const days = periodColumns('day', { picked: JULY, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true });
  assert.equal(days.length, 31, 'every day of July 2026');
  assert.ok(days.every(c => c.kind === 'full' && c.from === c.to));
  assert.deepEqual(days.filter(c => c.weekend).map(c => c.period), [
    '2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12', '2026-07-18', '2026-07-19', '2026-07-25', '2026-07-26',
  ], 'Saturdays and Sundays are marked, to keep them off the colour scale');
  assert.deepEqual(brief(periodColumns('week', { picked: JULY, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true })), [
    'part 2026-07-01..2026-07-05', 'full 2026-07-06..2026-07-12', 'full 2026-07-13..2026-07-19',
    'full 2026-07-20..2026-07-26', 'part 2026-07-27..2026-07-31',
  ], 'weeks the range cuts short count only the days inside it');
  assert.deepEqual(brief(periodColumns('month', { picked: { from: '2026-06-15', to: '2026-07-31' }, asOf: TUE_17_NOV })), [
    'part 2026-06-15..2026-06-30', 'full 2026-07-01..2026-07-31',
  ]);
});

test('a range running to today stops at the last day read, and WTD and MTD carry on from there', () => {
  const cols = periodColumns('week', { picked: { from: '2026-10-26', to: '2026-11-17' }, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true });
  assert.deepEqual(brief(cols), [
    'full 2026-10-26..2026-11-01', 'full 2026-11-02..2026-11-08', 'full 2026-11-09..2026-11-15',
    'wtd 2026-11-16..2026-11-17',
  ]);
  const days = periodColumns('day', { picked: { from: '2026-11-12', to: '2026-11-17' }, asOf: new Date(Date.UTC(2026, 10, 16)), now: TUE_17_NOV });
  assert.deepEqual(days.map(c => c.period), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], 'a day not yet read through is not a column; the weekend is');
  assert.deepEqual(brief(periodColumns('month', { picked: { from: '2026-11-01', to: '2026-11-17' }, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true })),
    ['mtd 2026-11-01..2026-11-17'], 'this month alone is only MTD');
});

test('nothing before the dashboard starts is a column', () => {
  const cols = periodColumns('month', { picked: { from: '2025-11-01', to: '2026-02-28' }, asOf: TUE_17_NOV, first: '2026-01-05' });
  assert.deepEqual(cols.map(c => c.period), ['2026-01-01', '2026-02-01']);
});

test('a DoD table ends with today so far, any day of the week', () => {
  assert.deepEqual(brief(periodColumns('day', { count: 2, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true })), [
    'full 2026-11-15..2026-11-15', 'full 2026-11-16..2026-11-16', 'today 2026-11-17..2026-11-17',
  ], 'Ayush, 2026-11-17: "is there a way we can get 17th\'s data as well"');
  const saturday = new Date(Date.UTC(2026, 10, 21));
  const weekend = periodColumns('day', { count: 2, asOf: saturday, now: saturday, toDate: true });
  assert.deepEqual(brief(weekend), ['full 2026-11-19..2026-11-19', 'full 2026-11-20..2026-11-20', 'today 2026-11-21..2026-11-21'], 'Saturday has its own today');
  assert.deepEqual(weekend.map(c => Boolean(c.weekend)), [false, false, true]);
  assert.ok(!periodColumns('week', { count: 2, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true }).some(c => c.kind === 'today'), 'WoW and MoM hold today in WTD and MTD');
  assert.ok(!periodColumns('day', { picked: JULY, asOf: TUE_17_NOV, now: TUE_17_NOV, toDate: true }).some(c => c.kind === 'today'), 'not when the dates end before today');
});
