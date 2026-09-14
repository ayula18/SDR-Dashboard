import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRange, trailingPeriods } from '../lib/metrics/filters.js';
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

test('custom ranges snap to whole months or weeks', () => {
  const months = resolveRange('custom', '2026-01-01', '2026-03-31', THU_10_SEP);
  assert.equal(months.grain, 'month');
  assert.deepEqual(months.periods, ['2026-01-01', '2026-02-01', '2026-03-01']);

  const weeks = resolveRange('custom', '2026-08-19', '2026-08-26', THU_10_SEP);
  assert.equal(weeks.grain, 'week');
  assert.deepEqual(weeks.periods, ['2026-08-17', '2026-08-24']);

  assert.throws(() => resolveRange('custom', '2026-08-10', '2026-08-01', THU_10_SEP), /before/);
});

test('trailing periods end with the period containing the date', () => {
  assert.deepEqual(trailingPeriods('week', '2026-09-10', 3), ['2026-08-24', '2026-08-31', '2026-09-07']);
  assert.deepEqual(trailingPeriods('month', '2026-09-10', 2), ['2026-08-01', '2026-09-01']);
});
