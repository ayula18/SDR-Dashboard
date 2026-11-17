import { pool } from './db.js';

/**
 * One row in GTM Hub's sign-in log per Google sign-in to SDR Command Center.
 *
 * `hub_login_events` is owned by GTM Hub (A1_Master Dashboard), whose admin
 * page reads it to show who signed in to which dashboard. This app only
 * appends. Explicit READ WRITE transaction because the transaction pooler can
 * hand us a connection another client left read-only.
 */
export async function logHubSignIn({ email, name }) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN READ WRITE');
    await client.query({
      text: `INSERT INTO hub_login_events (email, name, app) VALUES ($1, $2, 'd4')`,
      values: [String(email).toLowerCase(), name || null],
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
