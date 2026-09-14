/**
 * Applies db/migrations/*.sql in filename order, each inside a transaction,
 * recording them in dash_migrations. Views (*_views.sql, numbered 900 so they
 * follow every table change) are always re-applied so an edited definition
 * takes effect; tables and seeds run once.
 *
 *   npm run db:migrate
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, qp } from '../lib/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const ALWAYS_REAPPLY = /_views\.sql$/;

await qp(`CREATE TABLE IF NOT EXISTS dash_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
const applied = new Set((await qp('SELECT name FROM dash_migrations')).map(r => r.name));

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (applied.has(file) && !ALWAYS_REAPPLY.test(file)) {
    console.log(`skip   ${file}`);
    continue;
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN READ WRITE');
    await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await client.query(
      `INSERT INTO dash_migrations (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET applied_at = NOW()`,
      [file]
    );
    await client.query('COMMIT');
    console.log(`apply  ${file}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`FAILED ${file}: ${err.message}`);
    process.exitCode = 1;
    break;
  } finally {
    client.release();
  }
}

await pool().end();
