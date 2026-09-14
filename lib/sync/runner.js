import { qp } from '../db.js';

/**
 * Runs one sync job with bookkeeping: a dash_sync_runs row, a lock so two runs
 * of the same job never overlap, a resume cursor, and a time budget so a run
 * started from a route handler stops cleanly before the platform timeout and
 * carries on next time.
 *
 * A job's `run(ctx)` returns stats. `complete: false` marks a partial run;
 * `status: 'skipped'` means there was nothing it could do (e.g. no API key).
 * Thrown errors with code missing_scope / not_configured are recorded as
 * 'blocked': a setup problem for the health page, not a crash.
 */
export async function runJob(name, job, { mode = 'incremental', triggeredBy = 'cli', budgetMs = 240_000, log = console.log } = {}) {
  const [running] = await qp(
    `SELECT started_at FROM dash_sync_runs
      WHERE job = $1 AND status = 'running' AND started_at > NOW() - INTERVAL '30 minutes'
      ORDER BY id DESC LIMIT 1`,
    [name]
  );
  if (running) {
    return { job: name, status: 'skipped', reason: `already running since ${new Date(running.started_at).toISOString()}` };
  }

  const [{ id }] = await qp(
    `INSERT INTO dash_sync_runs (job, mode, triggered_by) VALUES ($1, $2, $3) RETURNING id`,
    [name, mode, triggeredBy]
  );
  const [state] = await qp(`SELECT cursor, last_success_at FROM dash_sync_state WHERE job = $1`, [name]);

  const ctx = {
    mode,
    deadline: Date.now() + budgetMs,
    cursor: state?.cursor ?? null,
    lastSuccessAt: state?.last_success_at ?? null,
    log: (...args) => log(`[${name}]`, ...args),
    saveCursor: cursor => qp(
      `INSERT INTO dash_sync_state (job, cursor, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (job) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW()`,
      [name, cursor == null ? null : JSON.stringify(cursor)]
    ),
  };

  try {
    const stats = (await job.run(ctx)) || {};
    const status = stats.status || (stats.complete === false ? 'partial' : 'complete');
    await qp(
      `UPDATE dash_sync_runs SET status = $2, stats = $3, finished_at = NOW() WHERE id = $1`,
      [id, status, JSON.stringify(stats)]
    );
    if (status === 'complete') {
      await qp(
        `INSERT INTO dash_sync_state (job, last_success_at, updated_at) VALUES ($1, NOW(), NOW())
         ON CONFLICT (job) DO UPDATE SET last_success_at = NOW(), updated_at = NOW()`,
        [name]
      );
    }
    return { job: name, status, stats };
  } catch (err) {
    const status = ['missing_scope', 'not_configured'].includes(err.code) ? 'blocked' : 'failed';
    await qp(
      `UPDATE dash_sync_runs SET status = $2, error = $3, finished_at = NOW() WHERE id = $1`,
      [id, status, String(err.message || err).slice(0, 1000)]
    );
    return { job: name, status, error: err.message };
  }
}
