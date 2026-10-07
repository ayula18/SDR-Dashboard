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
 * 'blocked', as is a job whose lock another run already holds: a setup or
 * timing problem for the health page, not a crash. A run that left no terminal
 * state because the platform killed it is reaped here as 'abandoned'.
 *
 * Every outcome writes a row. A job that produced no row at all is the failure
 * mode that hid a three-week-dead sync, so silence is never an acceptable result.
 */
export async function runJob(name, job, { mode = 'incremental', triggeredBy = 'cli', budgetMs = 240_000, log = console.log } = {}) {
  // A run the platform kills leaves status='running' with no finished_at forever.
  // That row is the newest for its job, so every health query ordering by id DESC
  // reports 'running' indefinitely, and it also blocks reruns. Make it terminal
  // first; the lock below then only sees runs that are genuinely still in flight.
  await qp(
    `UPDATE dash_sync_runs
        SET status = 'abandoned', finished_at = NOW(),
            error = COALESCE(error, 'No completion recorded; the run was killed before it finished.')
      WHERE job = $1 AND status = 'running' AND started_at <= NOW() - INTERVAL '30 minutes'`,
    [name]
  );

  const [running] = await qp(
    `SELECT started_at FROM dash_sync_runs
      WHERE job = $1 AND status = 'running' AND started_at > NOW() - INTERVAL '30 minutes'
      ORDER BY id DESC LIMIT 1`,
    [name]
  );
  if (running) {
    const reason = `already running since ${new Date(running.started_at).toISOString()}`;
    await qp(
      `INSERT INTO dash_sync_runs (job, status, mode, triggered_by, stats, finished_at)
       VALUES ($1, 'blocked', $2, $3, $4, NOW())`,
      [name, mode, triggeredBy, JSON.stringify({ reason })]
    ).catch(() => {});
    return { job: name, status: 'blocked', reason };
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
