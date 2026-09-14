import { requireAdmin, requireUser } from '@/lib/current-user';

/**
 * Wraps a route handler body: checks the session (proxy.js already did, but a
 * handler that asks is a stronger guarantee), runs it, and turns thrown errors
 * with a `status` into JSON responses.
 */
export async function handle(fn, { admin = false } = {}) {
  try {
    const user = admin ? await requireAdmin() : await requireUser();
    return Response.json(await fn(user));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return Response.json({ error: err.message || 'Something went wrong' }, { status });
  }
}
