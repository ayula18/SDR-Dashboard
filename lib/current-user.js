import { auth } from '@/auth';
import { qp } from '@/lib/db';

/**
 * The signed-in user, with the role read from sdr_users rather than the JWT.
 * Tokens live 30 days, so a role granted or revoked after sign-in would
 * otherwise take that long to apply. The token's role is only the fallback
 * when the database is unreachable.
 */
export async function currentUser() {
  const session = await auth();
  if (!session?.user?.email) return null;

  const email = session.user.email.toLowerCase();
  let role = session.user.role || 'sdr';
  try {
    const [row] = await qp(`SELECT role FROM sdr_users WHERE email = $1`, [email]);
    if (row?.role) role = row.role;
  } catch {
    // Keep the token's role rather than locking someone out mid-session.
  }
  return { email, name: session.user.name || null, image: session.user.image || null, role };
}

export function isAdmin(user) {
  return user?.role === 'admin';
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw httpError('Not signed in', 401);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw httpError('Only admins can do this', 403);
  return user;
}
