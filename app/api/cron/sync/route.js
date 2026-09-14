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

/** Daily incremental sync. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET` (see vercel.json). */
export async function GET(request) {
  if (!authorized(request.headers.get('authorization'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const results = await runJobs(DEFAULT_SEQUENCE, { mode: 'incremental', triggeredBy: 'cron', budgetMs: 280_000 });
  return Response.json({ results });
}
