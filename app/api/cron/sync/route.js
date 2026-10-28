import { timingSafeEqual } from 'crypto';
import { DEFAULT_SEQUENCE, runJobs } from '@/lib/sync/jobs';

export const maxDuration = 300;

function authorized(header) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The platform ceiling is 300s; 280s leaves room to answer before it bites. */
const FULL_BUDGET_MS = 280_000;
/** Below this a run cannot finish anything, however starved the job is. */
const MIN_BUDGET_MS = 10_000;

/**
 * Incremental sync. Callers send `Authorization: Bearer $CRON_SECRET`.
 *
 * `?budget=<seconds>` caps how long the run may take, because the caller's
 * patience is part of the problem:
 *
 *   Vercel Cron (vercel.json)  no param → the full 280s, once a day. This
 *                              trigger has never missed: 16 of 16 days, all at
 *                              03:20:48.
 *   cron-job.org, hourly       ?budget=25 — it stops waiting after 30s and
 *                              marks the run failed, which over time looks like
 *                              a job that never works. A short run answers in
 *                              time, goes green, and the staleness ordering plus
 *                              each job's cursor means the next hour continues
 *                              where this one stopped. That is cron-job.org's
 *                              own advice for work that outlasts the limit.
 *
 * 24 hourly slices of ~22s plus the daily 280s is ~800s against the ~424s a
 * fully fresh day needs.
 */
export async function GET(request) {
  if (!authorized(request.headers.get('authorization'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const asked = Number(new URL(request.url).searchParams.get('budget'));
  const budgetMs = Number.isFinite(asked) && asked > 0
    ? Math.min(Math.max(asked * 1000, MIN_BUDGET_MS), FULL_BUDGET_MS)
    : FULL_BUDGET_MS;

  const startedAt = Date.now();
  const results = await runJobs(DEFAULT_SEQUENCE, { mode: 'incremental', triggeredBy: 'cron', budgetMs });
  return Response.json({ budgetMs, tookMs: Date.now() - startedAt, results });
}
