/**
 * The database-free half of the auth setup, so proxy.js can load it on every
 * request without pulling in `pg`. auth.js layers the sdr_users callbacks on top.
 *
 * Same Google client, domain gate and roles as the AI SDR app: one sign-in
 * works for both, and an admin there is an admin here.
 */

import Google from 'next-auth/providers/google';
import { allowedDomains, isAllowedEmail } from './lib/auth-domains.js';

export { allowedDomains, isAllowedEmail };

export const authConfig = {
  // Auto-detected on Vercel only. Google redirects solely to URIs registered on
  // the OAuth client, so a forged Host cannot invent a callback destination.
  trustHost: true,

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        // `hd` is only a hint to Google's account chooser. signIn below is the gate.
        params: { hd: allowedDomains()[0], prompt: 'select_account' },
      },
    }),
  ],

  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login', error: '/login' },

  callbacks: {
    async signIn({ profile }) {
      // Without email_verified, a Workspace we don't control could assert any address.
      if (!profile?.email_verified) return false;
      return isAllowedEmail(profile.email);
    },
  },
};
