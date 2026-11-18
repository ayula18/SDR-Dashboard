import { qp, upsertRows, withTx } from '../../db.js';
import { CALL_COLUMNS, callRow, dialerCalls, nooksConfigured, nooksUsers } from '../../outreach/nooks.js';

const DAY_MS = 86_400_000;
/**
 * How far before its last complete run each run reads again. Nooks rewrites a call after
 * it is made (measured 2026-11-17 over 7,581 calls: a day at most, 24.2 hours), so three
 * days catch every change and a run or two that failed.
 */
const REREAD_DAYS = 3;
/** A backfill reads this many days at a time and can stop between them. */
const WINDOW_DAYS = 14;
/** Below this share of what is stored for a window, a read looks broken: keep the rows. */
const MIN_SHARE_OF_STORED = 0.8;
/** Time left at which a backfill stops at the next window rather than start one it cannot finish. */
const STOP_BEFORE_MS = 15_000;

/**
 * Calls made on the Nooks dialer into dash_calls, GET only (lib/outreach/nooks.js): the
 * users once, then the calls a window at a time. The first run, or `--full`, walks from
 * DASH_START_DATE and keeps a cursor, so a run that runs out of time carries on next
 * time; after that a run re-reads from three days before its last complete one, about
 * 5 to 15 requests at 150 to 600 calls a working day. A call Nooks no longer returns in a
 * window that was read in full is removed, as it would be from Nooks' own list.
 */
export const job = {
  label: 'Calls (Nooks dialer)',
  weight: 1,
  minSliceMs: 20_000,
  maxAgeHours: 36,
  closesDay: true, // calls per day (isDue in plan.js)

  async run({ mode, cursor, lastSuccessAt, deadline, saveCursor, log }) {
    if (!nooksConfigured()) return { status: 'skipped', reason: 'NOOKS_API_KEY is not set' };

    const now = new Date();
    const backfill = mode === 'full' || !lastSuccessAt || Boolean(cursor?.from);
    const start = backfill
      ? new Date(cursor?.from || `${process.env.DASH_START_DATE || '2026-01-05'}T00:00:00Z`)
      : new Date(new Date(lastSuccessAt).getTime() - REREAD_DAYS * DAY_MS);
    const end = new Date(now.getTime() + 60_000);

    const users = new Map((await nooksUsers()).map(u => [u.id, u]));
    let read = 0;
    let removed = 0;
    let windows = 0;
    const kept = [];

    for (let from = start; from < end; ) {
      const to = new Date(Math.min(from.getTime() + WINDOW_DAYS * DAY_MS, end.getTime()));
      const calls = await dialerCalls({ from, toExclusive: to });
      const rows = calls.map(call => callRow(call, users, now));
      const ids = rows.map(r => r[0]);

      await withTx(async client => {
        await upsertRows('dash_calls', CALL_COLUMNS, rows, { conflict: ['id'], client });
        const [{ stored }] = await qp(
          `SELECT count(*)::int AS stored FROM dash_calls WHERE called_at >= $1 AND called_at < $2`, [from, to], client);
        if (rows.length >= stored * MIN_SHARE_OF_STORED) {
          const gone = await qp(
            `DELETE FROM dash_calls WHERE called_at >= $1 AND called_at < $2 AND NOT (id = ANY($3::text[])) RETURNING id`,
            [from, to, ids], client);
          removed += gone.length;
        } else {
          kept.push(`${from.toISOString().slice(0, 10)}: read ${rows.length} of ${stored} stored`);
        }
      });

      read += rows.length;
      windows += 1;
      from = to;
      if (backfill) await saveCursor(from < end ? { from: from.toISOString() } : null);
      if (from < end && Date.now() > deadline - STOP_BEFORE_MS) {
        log(`stopped at ${from.toISOString().slice(0, 10)}; the next run carries on from there`);
        return { complete: false, backfill, calls: read, windows, removed, users: users.size, resumesFrom: from.toISOString() };
      }
    }

    if (kept.length) log(`left alone, the read looked short: ${kept.join('; ')}`);
    return { backfill, from: start.toISOString(), calls: read, windows, removed, users: users.size, shortReads: kept.length };
  },
};
