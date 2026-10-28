/**
 * Which `ctx_events.source` values are Instantly email.
 *
 * There are two, because the account has two Instantly workspaces: the
 * original, and the one the AI SDR agent sends from since 2026-10-15. The AI
 * SDR app's archive stamps each from its own connector key, so an AI SDR email
 * lands as `instantly_aisdr`, not `instantly`.
 *
 * THAT IS WHY THIS FILE EXISTS. `source = 'instantly'` reads as "an email we
 * sent" and silently stopped meaning that the day the second workspace
 * appeared: its replies were never picked up by reply-verdicts, so they were
 * never labelled, never counted as replied or positive, and never shown in a
 * conversation. Import this instead of writing the string, and a third
 * workspace is one line here rather than a hunt.
 *
 * The same list, with each workspace's API key, is in ./instantly.js
 * (`WORKSPACES`); that one is for reading the API, this one for reading the
 * archive. Import-free on purpose, so a constant never drags a client behind it.
 */

/** Both Instantly workspaces, as they appear in ctx_events.source. */
export const INSTANTLY_SOURCES = ['instantly', 'instantly_aisdr'];

/** Instantly plus HeyReach: every message we sent a prospect, as the archive names it. */
export const OUTREACH_SOURCES = [...INSTANTLY_SOURCES, 'heyreach'];

/**
 * A SQL list literal, for raw queries that cannot take a parameter here. The
 * values are compile-time constants from this file and never touch user input.
 */
export const sqlList = sources => sources.map(s => `'${s}'`).join(', ');
