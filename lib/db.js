import pg from 'pg';

const { Pool } = pg;
const globalForPool = globalThis;

/**
 * Singleton pool against the Supabase database shared with the AI SDR app
 * (transaction pooler, port 6543). Settings mirror that app's lib/db.js.
 *
 * Imported by both Next route handlers and plain-node scripts, so this file
 * (and everything under lib/sync, lib/metrics, lib/outreach) uses relative
 * imports only.
 */
export function pool() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) throw new Error('DATABASE_URL is not set in .env.local');
  if (globalForPool._dashPool) return globalForPool._dashPool;

  const parsed = new URL(connStr);
  globalForPool._dashPool = new Pool({
    host: parsed.hostname,
    port: parseInt(parsed.port || '5432', 10),
    database: parsed.pathname.replace(/^\//, ''),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 60000,
    keepAlive: true,
    allowExitOnIdle: true,
  });

  // The pooler drops idle clients; the next query simply gets a fresh one.
  globalForPool._dashPool.on('error', () => {});
  return globalForPool._dashPool;
}

// Connection-level failures only. A statement timeout is NOT retried: re-running
// a slow query four times just makes the page four times slower.
const TRANSIENT_ERROR = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up|Connection terminated|terminating connection|timeout exceeded when trying to connect|server closed the connection|Client has encountered a connection error/i;
const RETRY_BACKOFF = [200, 500, 1000, 2000];

// On a transaction pooler, a session setting another client left behind (such
// as default_transaction_read_only) can sit on whichever server connection we
// are handed. Writes therefore always run in an explicit READ WRITE transaction.
const WRITE_STATEMENT = /^\s*(insert|update|delete)\b|\b(insert\s+into|delete\s+from)\b|\bupdate\s+\w+(\s+\w+)?\s+set\b/i;

async function withRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_BACKOFF.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!TRANSIENT_ERROR.test(err?.message || '') || attempt === RETRY_BACKOFF.length) throw err;
      await new Promise(r => setTimeout(r, RETRY_BACKOFF[attempt]));
    }
  }
  throw lastErr;
}

async function runQuery(text, values, client) {
  if (client) return client.query({ text, values });
  // Unnamed prepared statements: required by the Supabase transaction pooler.
  if (WRITE_STATEMENT.test(text)) return withRetry(() => withTx(c => c.query({ text, values })));
  return withRetry(() => pool().query({ text, values }));
}

/** Parameterized query ($1, $2, …). Returns rows. Pass `client` inside withTx. */
export async function qp(text, values = [], client) {
  return (await runQuery(text, values, client)).rows;
}

/** Runs `fn(client)` inside one READ WRITE transaction, rolling back on error. */
export async function withTx(fn) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN READ WRITE');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Multi-row INSERT … ON CONFLICT DO UPDATE.
 *
 * `rows` are arrays aligned with `columns`. Rows repeating a conflict key are
 * collapsed (last one wins) because Postgres refuses to update the same row
 * twice in one statement. JSONB values must be passed pre-stringified.
 */
export async function upsertRows(table, columns, rows, { conflict, update, client, chunkSize = 500 } = {}) {
  if (!rows.length) return 0;

  const keyIdx = conflict.map(c => columns.indexOf(c));
  const unique = new Map();
  for (const row of rows) unique.set(keyIdx.map(i => String(row[i])).join(''), row);
  const deduped = [...unique.values()];

  const updateCols = update || columns.filter(c => !conflict.includes(c));
  const onConflict = updateCols.length
    ? `DO UPDATE SET ${updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`
    : 'DO NOTHING';

  for (let i = 0; i < deduped.length; i += chunkSize) {
    const chunk = deduped.slice(i, i + chunkSize);
    const values = [];
    const tuples = chunk.map(row => `(${row.map(v => { values.push(v); return `$${values.length}`; }).join(', ')})`);
    await runQuery(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT (${conflict.join(', ')}) ${onConflict}`,
      values,
      client,
    );
  }
  return deduped.length;
}
