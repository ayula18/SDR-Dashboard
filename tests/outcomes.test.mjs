import { test } from 'node:test';
import assert from 'node:assert/strict';
import { change, markExtremes, rate } from '../lib/metrics/format.js';
import { verdictRow } from '../lib/sync/verdicts.js';

// The keyword rules decide negative and automatic. A reply is positive only when its label is in
// POSITIVE_VERDICTS (interested, not now); see tests/linkedin.test.mjs and the views.
const judge = (body, extra = {}) => {
  const row = verdictRow({ id: 'test', platform: 'email', body, ...extra });
  return { verdict: row[8], negative: row[9], auto: row[10] };
};

test('out-of-office is automatic, never negative', () => {
  assert.deepEqual(judge('I am out of the office until Monday'), { verdict: 'auto', negative: false, auto: true });
});

test('refusals and opt-outs are negative', () => {
  assert.equal(judge('No thanks, not interested').negative, true);
  assert.equal(judge('Please unsubscribe me').negative, true);
});

test('interest, questions and anything unclear are not negative', () => {
  assert.deepEqual(judge('Sounds good, happy to chat next week'), { verdict: 'interested', negative: false, auto: false });
  assert.equal(judge('Can you share pricing?').negative, false);
});

test('a HeyReach "Not interested" tag makes a reply negative', () => {
  assert.deepEqual(judge('ok', { platform: 'linkedin', tags: ['Not interested'] }), { verdict: 'declined', negative: true, auto: false });
});

test('rates and changes handle empty denominators', () => {
  assert.equal(rate(1, 3), 33.3);
  assert.equal(rate(1, 0), null);
  assert.equal(change(120, 100), 20);
  assert.equal(change(5, 0), null);
});

test('best/worst highlighting ignores small samples and ties', () => {
  const rows = markExtremes([
    { positiveRate: 5, lowSample: false },
    { positiveRate: 1, lowSample: false },
    { positiveRate: 50, lowSample: true },
  ]);
  assert.equal(rows[0].best, true);
  assert.equal(rows[1].worst, true);
  assert.equal(rows[2].best, false);
  assert.equal(markExtremes([{ positiveRate: 0 }, { positiveRate: 0 }])[0].best, undefined);
});
