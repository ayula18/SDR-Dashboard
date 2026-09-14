/**
 * Sign-in with the role attached.
 *
 * Users live in `sdr_users`, the table the AI SDR app already maintains, so
 * roles are managed in one place. The board is visible to everyone who can
 * sign in; `admin` unlocks sync, campaign mapping and meeting imports.
 */

import NextAuth from 'next-auth';
import { authConfig } from './auth.config.js';
import { qp } from './lib/db.js';

/** First sign-in creates the row; later ones refresh the profile. `role` is never overwritten. */
async function upsertUser({ email, name, image }) {
  const rows = await qp(
    `INSERT INTO sdr_users (email, name, image, last_seen_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (email) DO UPDATE
       SET name         = COALESCE(EXCLUDED.name, sdr_users.name),
           image        = COALESCE(EXCLUDED.image, sdr_users.image),
           last_seen_at = NOW()
     RETURNING email, name, role`,
    [email.toLowerCase(), name || null, image || null]
  );
  return rows[0] || null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    /** `user` is only set at sign-in, so the database is touched once per sign-in. */
    async jwt({ token, user, profile }) {
      if (user) {
        const email = (profile?.email || user.email || '').toLowerCase();
        token.email = email;
        try {
          const row = await upsertUser({ email, name: profile?.name || user.name, image: profile?.picture || user.image });
          token.role = row?.role || 'sdr';
        } catch (err) {
          // A database blip must not lock out someone Google already verified.
          console.error('auth: sdr_users upsert failed:', err.message);
          token.role = token.role || 'sdr';
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email || session.user.email;
        session.user.role = token.role || 'sdr';
      }
      return session;
    },
  },
});
