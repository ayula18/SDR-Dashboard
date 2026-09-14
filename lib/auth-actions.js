'use server';

import { signIn, signOut } from '@/auth';

export async function startGoogleSignIn(formData) {
  // Relative paths only: an absolute URL would make the login page an open redirect.
  const raw = formData?.get('next');
  const next = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  await signIn('google', { redirectTo: next });
}

export async function endSession() {
  await signOut({ redirectTo: '/login' });
}
