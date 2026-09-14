/**
 * Who counts as "us". Same rule as the AI SDR app.
 *
 * No imports on purpose: this decides whether a stranger gets in, so it stays
 * testable on plain node without NextAuth or a database connection.
 */

export function allowedDomains(env = process.env) {
  return (env.AUTH_ALLOWED_DOMAINS || env.OUR_EMAIL_DOMAINS || 'reo.dev')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Strict about shapes that look like a match and are not:
 *   evil.com/x@reo.dev.attacker.com   the domain is attacker.com
 *   someone@notreo.dev                suffix matching would pass this
 *   a@b@reo.dev                       lastIndexOf, so the real domain wins
 */
export function isAllowedEmail(email, env = process.env) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;

  const at = trimmed.lastIndexOf('@');
  if (at < 1 || at === trimmed.length - 1) return false;

  return allowedDomains(env).includes(trimmed.slice(at + 1).toLowerCase());
}
