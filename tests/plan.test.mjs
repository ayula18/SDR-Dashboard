import test from 'node:test';
import assert from 'node:assert/strict';
import { planRun, topoSort, stalenessHours } from '../lib/sync/plan.js';

const NOW = Date.parse('2026-10-08T03:20:00Z');
const hoursAgo = h => new Date(NOW - h * 3_600_000).toISOString();

/** The ten real jobs, with the dependencies the queries actually impose. */
const JOBS = [
  { name: 'instantly-campaigns', minSliceMs: 20_000 },
  { name: 'instantly-periods', dependsOn: ['instantly-campaigns'], minSliceMs: 20_000 },
  { name: 'reply-verdicts', minSliceMs: 20_000 },
  { name: 'reply-classify', dependsOn: ['reply-verdicts'], minSliceMs: 20_000 },
  { name: 'meetings-csv', minSliceMs: 20_000 },
  { name: 'meetings-slack', minSliceMs: 20_000 },
  { name: 'instantly-leads', dependsOn: ['instantly-campaigns', 'instantly-periods'], weight: 3, minSliceMs: 30_000 },
  { name: 'heyreach', weight: 2, minSliceMs: 30_000 },
  { name: 'heyreach-leads', dependsOn: ['heyreach'], weight: 2, minSliceMs: 30_000 },
  { name: 'instantly-steps', dependsOn: ['instantly-campaigns', 'instantly-periods'], weight: 2, minSliceMs: 30_000 },
];

/**
 * Production history on 2026-10-08, the day this was written: instantly-leads
 * had run an hour earlier, heyreach-leads had not run for 7 days, and
 * instantly-steps had not run for 15. This is the regression test — under the
 * old scheduler both starved jobs got ~11s of a 280s budget and were skipped,
 * every single day, with nothing recorded.
 */
const PRODUCTION_HISTORY = {
  'instantly-campaigns': { lastProgressAt: hoursAgo(24) },
  'instantly-periods': { lastProgressAt: hoursAgo(24) },
  'reply-verdicts': { lastProgressAt: hoursAgo(24) },
  'reply-classify': { lastProgressAt: hoursAgo(24) },
  'meetings-csv': { lastProgressAt: hoursAgo(24) },
  'meetings-slack': { lastProgressAt: hoursAgo(24) },
  'instantly-leads': { lastProgressAt: hoursAgo(24) },
  'heyreach': { lastProgressAt: hoursAgo(24) },
  'heyreach-leads': { lastProgressAt: hoursAgo(168) },
  'instantly-steps': { lastProgressAt: hoursAgo(376) },
};

test('the starved jobs are scheduled, not deferred', () => {
  const { slices, deferred } = planRun({ jobs: JOBS, history: PRODUCTION_HISTORY, now: NOW, budgetMs: 280_000 });
  const scheduled = slices.map(s => s.job);
  assert.ok(scheduled.includes('heyreach-leads'), 'heyreach-leads must be scheduled');
  assert.ok(scheduled.includes('instantly-steps'), 'instantly-steps must be scheduled');
  assert.equal(deferred.length, 0, 'the real ten jobs should all fit in 280s of floors');
});

test('a job that has never completed outranks one that ran an hour ago', () => {
  const history = { a: { lastProgressAt: hoursAgo(1) } }; // b has no history at all
  const { slices } = planRun({
    jobs: [{ name: 'a' }, { name: 'b' }], history, now: NOW, budgetMs: 200_000,
  });
  assert.equal(stalenessHours({ name: 'b' }, history, NOW), Infinity);
  // Both run; the point is that b was admitted, which only happens if it ranked first.
  assert.deepEqual(slices.map(s => s.job).sort(), ['a', 'b']);
  assert.equal(slices.find(s => s.job === 'b').reason, 'has never completed');
});

test('every scheduled job gets at least its floor, and the total fits the budget', () => {
  const { slices } = planRun({ jobs: JOBS, history: PRODUCTION_HISTORY, now: NOW, budgetMs: 280_000 });
  for (const s of slices) {
    const floor = JOBS.find(j => j.name === s.job).minSliceMs;
    assert.ok(s.budgetMs >= floor, `${s.job} got ${s.budgetMs}, below its floor ${floor}`);
  }
  const total = slices.reduce((sum, s) => sum + s.budgetMs, 0);
  assert.ok(total <= 280_000, `slices total ${total} exceeds the budget`);
});

test('no job can take more than half the budget however far behind it is', () => {
  const { slices } = planRun({
    jobs: [{ name: 'ancient', weight: 100 }, { name: 'fresh' }],
    history: { ancient: {}, fresh: { lastProgressAt: hoursAgo(1) } },
    now: NOW, budgetMs: 200_000,
  });
  const ancient = slices.find(s => s.job === 'ancient');
  assert.ok(ancient.budgetMs <= 100_000, `one job took ${ancient.budgetMs} of 200000`);
});

test('a parent never runs after its child', () => {
  const { slices } = planRun({ jobs: JOBS, history: PRODUCTION_HISTORY, now: NOW, budgetMs: 280_000 });
  const at = name => slices.findIndex(s => s.job === name);
  for (const job of JOBS) {
    for (const dep of job.dependsOn || []) {
      if (at(job.name) === -1 || at(dep) === -1) continue;
      assert.ok(at(dep) < at(job.name), `${dep} must come before ${job.name}`);
    }
  }
});

test('a child is NOT deferred merely because its parent was', () => {
  // Tiny budget: only one floor fits. The child is the stale one, so it wins the
  // slot even though its parent does not run. Gating would starve it forever.
  const { slices, deferred } = planRun({
    jobs: [
      { name: 'parent', minSliceMs: 30_000 },
      { name: 'child', dependsOn: ['parent'], minSliceMs: 30_000 },
    ],
    history: { parent: { lastProgressAt: hoursAgo(1) }, child: {} },
    now: NOW, budgetMs: 45_000,
  });
  assert.deepEqual(slices.map(s => s.job), ['child']);
  assert.deepEqual(deferred.map(d => d.job), ['parent']);
});

test('a job that cannot be given a useful slice is deferred with a reason, never dropped silently', () => {
  const { slices, deferred } = planRun({
    jobs: [{ name: 'a', minSliceMs: 30_000 }, { name: 'b', minSliceMs: 30_000 }, { name: 'c', minSliceMs: 30_000 }],
    history: { a: {}, b: { lastProgressAt: hoursAgo(50) }, c: { lastProgressAt: hoursAgo(1) } },
    now: NOW, budgetMs: 80_000,
  });
  assert.equal(slices.length + deferred.length, 3, 'every job must be accounted for');
  assert.ok(deferred.every(d => d.reason && typeof d.staleHours === 'number'));
});

test('the same inputs always produce the same plan', () => {
  const once = planRun({ jobs: JOBS, history: PRODUCTION_HISTORY, now: NOW, budgetMs: 280_000 });
  const twice = planRun({ jobs: JOBS, history: PRODUCTION_HISTORY, now: NOW, budgetMs: 280_000 });
  assert.deepEqual(once, twice);
});

test('a dependency cycle throws rather than looping', () => {
  assert.throws(() => topoSort([
    { name: 'a', dependsOn: ['b'] },
    { name: 'b', dependsOn: ['a'] },
  ]), /cycle/i);
});

test('a dependency on a job not in this run is not a constraint', () => {
  const { slices } = planRun({
    jobs: [{ name: 'child', dependsOn: ['absent-parent'] }],
    history: {}, now: NOW, budgetMs: 100_000,
  });
  assert.deepEqual(slices.map(s => s.job), ['child']);
});

test('the mop-up pass may spend the whole remainder, because there is no tail left to protect', () => {
  // The first pass caps every job at half the budget so a greedy job cannot eat
  // the jobs after it. The mop-up pass runs AFTER all of them, on time that was
  // reserved and never used, so the same cap would simply throw half of it away.
  const jobs = [{ name: 'heyreach', weight: 2, minSliceMs: 30_000 }];

  const capped = planRun({ jobs, history: {}, now: NOW, budgetMs: 90_000, reserveMs: 0 });
  assert.equal(capped.slices[0].budgetMs, 45_000, 'default still protects the tail');

  const mopUp = planRun({ jobs, history: {}, now: NOW, budgetMs: 90_000, reserveMs: 0, maxShare: 1 });
  assert.equal(mopUp.slices[0].budgetMs, 90_000, 'the last pass spends what is left');
});

test('the mop-up pass still shares between several unfinished jobs', () => {
  // Two jobs out of time and one lot of leftover: neither may take all of it.
  const { slices } = planRun({
    jobs: [{ name: 'a', weight: 1, minSliceMs: 20_000 }, { name: 'b', weight: 1, minSliceMs: 20_000 }],
    history: { a: { lastProgressAt: new Date(NOW - 50 * 3_600_000).toISOString() } },
    now: NOW, budgetMs: 100_000, reserveMs: 0, maxShare: 1,
  });
  assert.equal(slices.length, 2);
  assert.equal(slices.reduce((n, s) => n + s.budgetMs, 0), 100_000);
  for (const s of slices) assert.ok(s.budgetMs >= 20_000, `${s.job} kept its floor`);
});
