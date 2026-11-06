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
 * Vercel Cron calls this once a day (vercel.json) and cron-job.org calls it through
 * the day, because a full pass does not fit in one call. Both are only clocks: each
 * call starts just the jobs that are due (isDue in lib/sync/plan.js), and a job cut
 * short by the time limit continues on the next call. A call with nothing due ends
 * at once, so these calls cost next to nothing however often they come.
 *
 * cron-job.org stops waiting after 30s and shows a timeout, but the function carries
 * on. `?budget=<seconds>` caps a run for a caller that needs a real answer in time.
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
  const results = await runJobs(DEFAULT_SEQUENCE, { mode: 'incremental', triggeredBy: 'cron', budgetMs, onlyDue: true });
  return Response.json({ budgetMs, tookMs: Date.now() - startedAt, results });
}
