import { qp } from '../db.js';
import { runJob } from './runner.js';
import { isDue, planRun } from './plan.js';
import { job as instantlyCampaigns } from './jobs/instantly-campaigns.js';
import { job as instantlyPeriods } from './jobs/instantly-periods.js';
import { job as instantlyLeads } from './jobs/instantly-leads.js';
import { job as instantlySteps } from './jobs/instantly-steps.js';
import { job as emailFirstTouch } from './jobs/email-first-touch.js';
import { job as replyVerdicts } from './jobs/reply-verdicts.js';
import { job as replyClassify } from './jobs/reply-classify.js';
import { job as heyreach } from './jobs/heyreach.js';
import { job as heyreachLeads } from './jobs/heyreach-leads.js';
import { job as linkedinFirstMessage } from './jobs/linkedin-first-message.js';
import { job as meetingsSheet } from './jobs/meetings-sheet.js';
import { job as meetingsSlack } from './jobs/meetings-slack.js';
import { job as meetingsSdrForm } from './jobs/meetings-sdr-form.js';
import { job as meetingsHubspot } from './jobs/meetings-hubspot.js';
import { job as meetingsEvidence } from './jobs/meetings-evidence.js';
import { job as companyIdentity } from './jobs/company-identity.js';
import { job as positiveSheet } from './jobs/positive-sheet.js';

/**
 * What this app pulls, and what it leaves to the AI SDR app.
 *
 * Message content, meaning every Instantly email and HeyReach conversation, is
 * pulled once by the AI SDR app's syncs into ctx_events; reply-verdicts and
 * reply-classify read it from there. This app pulls only what the AI SDR app
 * does not: Instantly campaigns, analytics, leads and steps, HeyReach campaign
 * stats and the people in each campaign, the meetings audit sheet, and the SDRs' positive
 * response sheet.
 */
export const JOBS = {
  'company-identity': companyIdentity,
  'instantly-campaigns': instantlyCampaigns,
  'instantly-periods': instantlyPeriods,
  'instantly-leads': instantlyLeads,
  'instantly-steps': instantlySteps,
  'email-first-touch': emailFirstTouch,
  'reply-verdicts': replyVerdicts,
  'reply-classify': replyClassify,
  'heyreach': heyreach,
  'heyreach-leads': heyreachLeads,
  'linkedin-first-message': linkedinFirstMessage,
  'meetings-sheet': meetingsSheet,
  'meetings-slack': meetingsSlack,
  'meetings-sdr-form': meetingsSdrForm,
  'meetings-hubspot': meetingsHubspot,
  'meetings-evidence': meetingsEvidence,
  'positive-sheet': positiveSheet,
};

// Campaigns and periods first (later jobs look them up), then the cheap, high-value
// jobs, so a time-limited run such as the Vercel cron always finishes those. The long
// per-campaign jobs go last and resume where they stopped on the next run.
export const DEFAULT_SEQUENCE = [
  // First: every later job's company counts are keyed on the canonical domains this writes.
  'company-identity',
  'instantly-campaigns',
  'instantly-periods',
  'reply-verdicts',
  'reply-classify', // labels the replies reply-verdicts just picked up from the archive
  'meetings-sheet', // the meetings audit, which the alert, form and HubSpot jobs below stand aside for
  'meetings-slack', // meetings booked, read from the Slack alerts the archive already holds
  'meetings-sdr-form', // who booked them, from the form SDRs fill on HubSpot deals, and any only it knows
  'meetings-hubspot', // and whatever HubSpot knows that none of those carry
  'meetings-evidence', // then decide what came of every one of them
  'positive-sheet', // what the SDRs logged, tied to the people and replies above, then the bookings they did not log
  'instantly-leads',
  'email-first-touch', // when each lead was first emailed, which is what ranges count companies by
  'heyreach',
  'heyreach-leads', // needs the campaign rows the heyreach job writes
  'linkedin-first-message', // and dates the people that job just added
  'instantly-steps',
];

const RUN_HISTORY_DAYS = 90;

/** Below this there is no point starting a job again: it burns a rate-limit slot for nothing. */
const MIN_MOPUP_MS = 15_000;

/**
 * Record that a job did not get to run.
 *
 * Not running used to write nothing at all, so a job starved every night for
 * weeks still showed its last budgeted run on the health page — "complete, 15
 * days ago" — and nothing anywhere recorded the starvations in between.
 *
 * 'deferred' rather than 'skipped': 'skipped' already means "nothing to do"
 * (no API key), and meta.js reads a skipped heyreach run as a missing key.
 */
async function recordDeferred(name, options, reason, extra = {}) {
  await qp(
    `INSERT INTO dash_sync_runs (job, status, mode, triggered_by, stats, finished_at)
     VALUES ($1, 'deferred', $2, $3, $4, NOW())`,
    [
      name,
      options.mode ?? 'incremental',
      options.triggeredBy ?? 'cli',
      JSON.stringify({ reason, ...extra }),
    ]
  ).catch(() => {}); // bookkeeping must never abort the remaining jobs
}

/**
 * When each job last got somewhere, used to rank by staleness.
 *
 * Read from dash_sync_runs rather than dash_sync_state.last_success_at, because
 * that column only advances on 'complete'. A job like heyreach-leads that makes
 * real progress every run but never finishes a full pass would otherwise look
 * infinitely starved forever and permanently outrank everything else.
 */
async function loadHistory() {
  const rows = await qp(`
    SELECT r.job,
           max(r.finished_at) FILTER (WHERE r.status IN ('complete', 'partial')) AS "lastProgressAt",
           max(r.finished_at) FILTER (WHERE r.status = 'complete')               AS "lastSuccessAt"
      FROM dash_sync_runs r
     WHERE r.started_at > NOW() - INTERVAL '90 days'
     GROUP BY r.job`);
  return Object.fromEntries(rows.map(r => [r.job, r]));
}

/**
 * Run jobs under one shared time budget, ordered and sliced so none can starve.
 *
 * Each job is capped at its planned slice rather than handed everything left:
 * that cap is what stops a long job consuming the tail, which is how
 * heyreach-leads and instantly-steps went 7 and 15 days without running.
 * Unspent time from a job that finishes early is still returned to the pool.
 *
 * `onlyDue` is for the scheduled calls: jobs that finished recently are left out,
 * so a call with nothing due ends at once. A job left out writes no row. Its last
 * complete row already says when it ran, and it can only be left out for
 * EVERY_HOURS after that row, well inside the maxAgeHours that meta.js flags.
 * A person asking for a sync always gets one.
 */
export async function runJobs(names, { budgetMs = 240_000, onlyDue = false, ...options } = {}) {
  const deadline = Date.now() + budgetMs;
  const results = [];

  const known = names.filter(n => JOBS[n]);
  for (const name of names) {
    if (!JOBS[name]) results.push({ job: name, status: 'failed', error: `Unknown job "${name}"` });
  }

  const history = await loadHistory().catch(() => ({}));
  const due = known.filter(name => !onlyDue || isDue({ name }, history, Date.now()));
  for (const name of known) {
    if (!due.includes(name)) results.push({ job: name, status: 'not-due' });
  }
  if (!due.length) return results;

  const { slices, deferred } = planRun({
    jobs: due.map(name => ({ name, ...JOBS[name] })),
    history,
    now: Date.now(),
    budgetMs,
  });

  for (const d of deferred) {
    await recordDeferred(d.job, options, d.reason, { staleHours: d.staleHours });
    results.push({ job: d.job, status: 'deferred', reason: d.reason });
  }

  for (const slice of slices) {
    const name = slice.job;
    const remaining = deadline - Date.now();
    if (remaining < 5000) {
      const reason = 'Out of time for this run; it runs next time';
      await recordDeferred(name, options, reason, { remainingMs: remaining });
      results.push({ job: name, status: 'deferred', reason });
      continue;
    }

    // The cap is the point: a job may use less than its slice, and the time it
    // leaves goes back to the pool, but it can never take the tail's share.
    results.push(await runJob(name, JOBS[name], {
      ...options,
      budgetMs: Math.min(slice.budgetMs, remaining),
    }));
  }

  // ── Mop-up: spend what the first pass reserved and did not use ────────────
  //
  // Every slice is a cap, and a job that finishes inside its cap hands the rest
  // back — but nothing ever picked it up, so the time was reserved and then
  // thrown away. Measured 2026-10-20: 190s of a 270s budget spent while heyreach
  // stopped at its 36s cap, leaving ~90s unused with work still queued.
  //
  // Jobs that ran out of time or never started get it, most-starved first, under
  // the same planner (maxShare 1: there is no tail left to protect). Each retry
  // writes its own dash_sync_runs row, so the history says plainly that a job ran
  // twice rather than quietly extending the first run's slice.
  const unfinished = results.filter(r => r.status === 'partial' || r.status === 'deferred');
  const spare = deadline - Date.now();
  if (unfinished.length && spare > MIN_MOPUP_MS) {
    const { slices: extra } = planRun({
      jobs: unfinished.map(r => ({ name: r.job, ...JOBS[r.job] })),
      history,
      now: Date.now(),
      budgetMs: spare,
      reserveMs: 0,
      maxShare: 1,
    });
    for (const slice of extra) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_MOPUP_MS) break;
      const again = await runJob(slice.job, JOBS[slice.job], {
        ...options,
        budgetMs: Math.min(slice.budgetMs, remaining),
      });
      results.push({ ...again, pass: 2 });
    }
  }

  // Keep 90 days of run history. A failed cleanup must never fail the sync itself.
  await qp(`DELETE FROM dash_sync_runs WHERE started_at < NOW() - INTERVAL '${RUN_HISTORY_DAYS} days'`).catch(() => {});
  return results;
}
