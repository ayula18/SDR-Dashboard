/**
 * Everything requires a signed-in reo.dev account. Doing it here rather than
 * per route means a page or API added later is covered the moment it exists.
 *
 *   a page  -> redirect to /login, remembering where they were headed
 *   an API  -> 401 JSON, since fetch() can't follow a redirect to a login screen
 */

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from './auth.config.js';

const { auth } = NextAuth(authConfig);

/** Reachable without a session. /api/cron checks CRON_SECRET itself. */
function isPublic(pathname) {
  return pathname.startsWith('/api/auth') || pathname.startsWith('/api/cron') || pathname === '/login';
}

export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname) || req.auth?.user) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const login = new URL('/login', req.nextUrl.origin);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)'],
};
