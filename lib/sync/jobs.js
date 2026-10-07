import { qp } from '../db.js';
import { runJob } from './runner.js';
import { job as instantlyCampaigns } from './jobs/instantly-campaigns.js';
import { job as instantlyPeriods } from './jobs/instantly-periods.js';
import { job as instantlyLeads } from './jobs/instantly-leads.js';
import { job as instantlySteps } from './jobs/instantly-steps.js';
import { job as replyVerdicts } from './jobs/reply-verdicts.js';
import { job as replyClassify } from './jobs/reply-classify.js';
import { job as heyreach } from './jobs/heyreach.js';
import { job as heyreachLeads } from './jobs/heyreach-leads.js';
import { job as meetingsCsv } from './jobs/meetings-csv.js';
import { job as meetingsSlack } from './jobs/meetings-slack.js';

/**
 * What this app pulls, and what it leaves to the AI SDR app.
 *
 * Message content, meaning every Instantly email and HeyReach conversation, is
 * pulled once by the AI SDR app's syncs into ctx_events; reply-verdicts and
 * reply-classify read it from there. This app pulls only what the AI SDR app
 * does not: Instantly campaigns, analytics, leads and steps, HeyReach campaign
 * stats and the people in each campaign, and the meetings sheet.
 */
export const JOBS = {
  'instantly-campaigns': instantlyCampaigns,
  'instantly-periods': instantlyPeriods,
  'instantly-leads': instantlyLeads,
  'instantly-steps': instantlySteps,
  'reply-verdicts': replyVerdicts,
  'reply-classify': replyClassify,
  'heyreach': heyreach,
  'heyreach-leads': heyreachLeads,
  'meetings-csv': meetingsCsv,
  'meetings-slack': meetingsSlack,
};

// Campaigns and periods first (later jobs look them up), then the cheap, high-value
// jobs, so a time-limited run such as the Vercel cron always finishes those. The long
// per-campaign jobs go last and resume where they stopped on the next run.
export const DEFAULT_SEQUENCE = [
  'instantly-campaigns',
  'instantly-periods',
  'reply-verdicts',
  'reply-classify', // labels the replies reply-verdicts just picked up from the archive
  'meetings-csv',
  'meetings-slack', // meetings booked, read from the Slack alerts the archive already holds
  'instantly-leads',
  'heyreach',
  'heyreach-leads', // needs the campaign rows the heyreach job writes
  'instantly-steps',
];

const RUN_HISTORY_DAYS = 90;

/** Runs jobs in order under one shared time budget; jobs that don't fit are recorded as 'deferred' and run next time. */
export async function runJobs(names, { budgetMs = 240_000, ...options } = {}) {
  const deadline = Date.now() + budgetMs;
  const results = [];
  for (const name of names) {
    if (!JOBS[name]) {
      results.push({ job: name, status: 'failed', error: `Unknown job "${name}"` });
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining < 5000) {
      // Running out of time used to write no row at all, so a job starved every day
      // for weeks still showed its last budgeted run on the health page — "complete,
      // 15 days ago" — and nothing recorded the starvations in between.
      // 'deferred', not 'skipped': 'skipped' already means "nothing to do" (no API
      // key), and meta.js reads a skipped heyreach run as a missing key.
      const reason = 'Out of time for this run; it runs next time';
      await qp(
        `INSERT INTO dash_sync_runs (job, status, mode, triggered_by, stats, finished_at)
         VALUES ($1, 'deferred', $2, $3, $4, NOW())`,
        [name, options.mode ?? 'incremental', options.triggeredBy ?? 'cli', JSON.stringify({ reason, remainingMs: remaining })]
      ).catch(() => {}); // bookkeeping must never abort the remaining jobs
      results.push({ job: name, status: 'deferred', reason });
      continue;
    }
    results.push(await runJob(name, JOBS[name], { ...options, budgetMs: remaining }));
  }

  // Keep 90 days of run history. A failed cleanup must never fail the sync itself.
  await qp(`DELETE FROM dash_sync_runs WHERE started_at < NOW() - INTERVAL '${RUN_HISTORY_DAYS} days'`).catch(() => {});
  return results;
}
