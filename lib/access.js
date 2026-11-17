/**
 * Who sees which pages, defined once (Ayush, 2026-11-17: "hide all the other tabs except
 * these 3 for other people. and only i the superadmin ... will be able to see those extra
 * tabs"). Everyone signed in sees the open pages; every other page is the super admin's.
 * The proxy turns anyone else away from those pages and the sidebar leaves them out.
 * The APIs stay open to everyone signed in, because the open pages read them too.
 *
 * No imports on purpose: the proxy runs it before any page, and the sidebar in the browser.
 */

/** The super admins, by Google sign-in email. */
export const SUPER_ADMINS = ['ayushlahoti@reo.dev'];

/** The pages everyone signed in sees: Overview, SDR Detailed - Metrics, Snapshot View. */
export const OPEN_PAGES = ['/', '/sdr-metrics', '/snapshot'];

export const isSuperAdmin = email => SUPER_ADMINS.includes(String(email || '').trim().toLowerCase());

/** Whether this person may open this page. Only page paths: an API is not a page. */
export const canSeePage = (pathname, email) => OPEN_PAGES.includes(pathname) || isSuperAdmin(email);
