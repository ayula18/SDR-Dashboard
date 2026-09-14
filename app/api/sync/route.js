import { handle } from '@/lib/api';
import { qp } from '@/lib/db';
import { badRequest } from '@/lib/metrics/format';
import { DEFAULT_SEQUENCE, JOBS, runJobs } from '@/lib/sync/jobs';

export const maxDuration = 300;

/** The job list and the 50 most recent runs. */
export async function GET() {
  return handle(async () => ({
    jobs: Object.entries(JOBS).map(([key, job]) => ({ key, label: job.label })),
    runs: await qp(`
      SELECT id, job, status, mode, triggered_by AS "triggeredBy", stats, error,
             started_at AS "startedAt", finished_at AS "finishedAt"
        FROM dash_sync_runs ORDER BY id DESC LIMIT 50`),
  }));
}

/**
 * Admins: sync now. Body: { jobs?: string[], mode?: 'incremental' | 'full' }.
 * Runs within this request's time limit; long jobs save a cursor and continue
 * on the next call.
 */
export async function POST(request) {
  return handle(async user => {
    const body = await request.json().catch(() => ({}));
    const jobs = Array.isArray(body.jobs) && body.jobs.length ? body.jobs : DEFAULT_SEQUENCE;
    const unknown = jobs.filter(j => !JOBS[j]);
    if (unknown.length) throw badRequest(`Unknown job(s): ${unknown.join(', ')}`);

    const results = await runJobs(jobs, {
      mode: body.mode === 'full' ? 'full' : 'incremental',
      triggeredBy: user.email,
      budgetMs: 270_000,
    });
    return { results };
  }, { admin: true });
}
