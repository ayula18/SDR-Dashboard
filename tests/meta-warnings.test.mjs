import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetCoverageWarning } from '../lib/metrics/meta.js';
import { JOBS } from '../lib/sync/jobs.js';

test('the meetings sheet is flagged by what it covers', () => {
  assert.match(sheetCoverageWarning({ meetings: 164, onSheet: 6 }).message, /holds 6 of the 164 meetings/);
  assert.equal(sheetCoverageWarning({ meetings: 164, onSheet: 82 }), null);
  assert.equal(sheetCoverageWarning({ meetings: 0, onSheet: 0 }), null);
});

test('a snapshot job promises no freshness it cannot keep', () => {
  assert.equal(JOBS['meetings-csv'].maxAgeHours, undefined);
});
