/**
 * Runs sync jobs from the terminal, without the route-handler time limit.
 *
 *   npm run sync                            incremental, every job
 *   npm run sync -- --full                  full backfill, every job
 *   npm run sync -- instantly-leads --full  one job
 *   npm run sync -- --budget=280           simulate the cron's budget exactly
 */

import { DEFAULT_SEQUENCE, JOBS, runJobs } from '../lib/sync/jobs.js';
import { pool } from '../lib/db.js';

const args = process.argv.slice(2);
const names = args.filter(a => !a.startsWith('--'));
const unknown = names.filter(n => n !== 'all' && !JOBS[n]);
if (unknown.length) {
  console.error(`Unknown job: ${unknown.join(', ')}\nJobs: ${Object.keys(JOBS).join(', ')}`);
  process.exit(1);
}

// A terminal run has no platform timeout, so it gets three hours by default.
// --budget=<seconds> reproduces what the scheduled run actually has, which is
// the only way to exercise the slicing and the mop-up pass before shipping them.
const budgetArg = args.find(a => a.startsWith('--budget='));
const budgetMs = budgetArg ? Number(budgetArg.split('=')[1]) * 1000 : 3 * 60 * 60 * 1000;
if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
  console.error('--budget wants a number of seconds, e.g. --budget=280');
  process.exit(1);
}

const results = await runJobs(!names.length || names.includes('all') ? DEFAULT_SEQUENCE : names, {
  mode: args.includes('--full') ? 'full' : 'incremental',
  triggeredBy: 'cli',
  budgetMs,
});

console.table(results.map(r => ({ job: r.job, status: r.status, detail: r.error || r.reason || JSON.stringify(r.stats) })));
await pool().end();
if (results.some(r => r.status === 'failed')) process.exitCode = 1;
