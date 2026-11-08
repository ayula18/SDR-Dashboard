import { normalizeDomain } from './domains.js';

/**
 * The HubSpot SDR form's post in Slack #sales-sdr-outreach, read as evidence of
 * where a meeting came from. When an SDR fills the form, HubSpot posts:
 *
 *   <http://nimbleway.com|nimbleway.com> - Meeting booked
 *   11/5/26 - Meeting scheduled on
 *
 *   Justus Santiago
 *   Yesterday 3:53am
 *   Good to be connected Garima!
 *   …the conversation the SDR pasted: a LinkedIn chat, an email thread or a Nooks call
 *
 * The AI SDR app archives that channel into ctx_events, so this reads text we
 * already hold: no API call. Pure, so it is tested without a database. The pasted
 * text is read in memory and never stored (CLAUDE.md: conversations stay in
 * ctx_events); only what it shows is kept: the channel and who is in it.
 */

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
// Slack writes links as <http://jfrog.com|jfrog.com> and addresses as <mailto:a@b.com|a@b.com>.
const unslack = text => String(text ?? '')
  .replace(/<(?:mailto:|https?:\/\/)?([^|>]+)(?:\|[^>]*)?>/g, '$1')
  .replace(/&(amp|lt|gt|quot|#39);/g, m => ENTITIES[m])
  .replace(/[​-‍﻿]/g, '');

const HEAD = /^\s*(.+?)\s+-\s+Meeting booked\s*$/i;
const SCHEDULED = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*Meeting scheduled on\b/i;

/** A typed date this far past the post is a typed year: ag-grid.com's "3/17/27", posted in March 2026. */
const FURTHEST_AHEAD_DAYS = 180;
/** Where a meeting falls, in days from the post that booked it. Outside it, a date typed day-first is tried. */
const PLAUSIBLE = { before: -14, after: 60 };

const iso = (y, m, d) => {
  const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(day);
  return Number.isNaN(t) || new Date(t).getUTCDate() !== Number(d) ? null : day;
};

/**
 * One form post → { domain, date, said }, or null when the message is not the form's
 * post. `postedAt` is when Slack got it, which places a mistyped year, and a date typed
 * day-first: dash0.com's "12/8/26", posted on 11 Aug, is 12 Aug, not 8 Dec.
 */
export function readFormPost(body, postedAt = null) {
  const lines = String(body ?? '').split('\n');
  const head = lines[0]?.match(HEAD);
  const when = lines[1]?.match(SCHEDULED);
  if (!head || !when) return null;
  const [m, d] = [Number(when[1]), Number(when[2])];
  let year = Number(when[3].length === 2 ? `20${when[3]}` : when[3]);
  const posted = postedAt ? new Date(postedAt).getTime() : null;
  const offset = day => (Date.parse(day) - posted) / 86_400_000;
  if (posted && iso(year, m, d) && offset(iso(year, m, d)) > FURTHEST_AHEAD_DAYS) year -= 1;
  let date = iso(year, m, d);
  const fits = day => day && offset(day) >= PLAUSIBLE.before && offset(day) <= PLAUSIBLE.after;
  if (posted && !fits(date) && fits(iso(year, d, m))) date = iso(year, d, m);
  const said = unslack(lines.slice(1).join('\n').replace(SCHEDULED, ''));
  return { domain: normalizeDomain(unslack(head[1])), date, said: said.trim() };
}

/** Every address the pasted conversation shows. An address is a person, wherever our data files them. */
export function emailsIn(said) {
  return [...new Set((String(said ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) || [])
    .map(e => e.replace(/\.$/, '')))];
}

// A Nooks call: its transcript, "[00:00:03] akhil@reo.dev: Corey?" line after line, or its AI summary.
const CALL_LINE = /\[\d{2}:\d{2}:\d{2}\]\s*[^:\n]{1,60}:/g;
const CALL_SUMMARY = /\bNooks AI summary\b/i;
// What only a LinkedIn copy carries: the web inbox's "sent the following message",
// the profile link, HeyReach's Avatar lines, a degree badge, an InMail.
const LINKEDIN_SURE = /\bAvatar\b|sent the following messages?\b|\bView [^\n]{1,40}?['’]s profile|\b(?:1st|2nd|3rd) degree connection|\bInMail\b/i;
const LINKEDIN_LIKELY = /\bthanks?(?: you)? for connecting\b|\bgood to (?:be )?connect(?:ed)?\b|['’]s LI\b|\bLI conversation\b|\bon LinkedIn\b/i;
// What only an email copy carries: headers, Gmail's inbox chrome, a quoted "wrote:".
const EMAIL_SURE = /^\s*(?:From|Subject|To|Cc)\s*:|\bwrote:|\bExternal Inbox\b|\bSent from my\b|\(\d+ (?:minutes?|hours?|days?) ago\)|^\s*Re:\s/im;
const EMAIL_LIKELY = /<[^<>\s@]+@[^<>\s@]+\.[a-z]{2,}>/i;

const firstAt = (text, pattern) => {
  const m = text.match(pattern);
  return m ? m.index : -1;
};

/**
 * Which channel the pasted conversation happened on: 'call', 'linkedin', 'email',
 * or null when it does not show. When a copy carries marks of both, the one that
 * comes first is the conversation and the other is quoted inside it.
 */
export function postChannel(said) {
  const text = String(said ?? '');
  if ((text.match(CALL_LINE) || []).length >= 2 || CALL_SUMMARY.test(text)) return 'call';
  const li = firstAt(text, LINKEDIN_SURE);
  const em = firstAt(text, EMAIL_SURE);
  if (li >= 0 && em >= 0) return li < em ? 'linkedin' : 'email';
  if (li >= 0) return 'linkedin';
  if (em >= 0) return 'email';
  if (LINKEDIN_LIKELY.test(text)) return 'linkedin';
  if (EMAIL_LIKELY.test(text)) return 'email';
  return null;
}

const plain = value => String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
const words = value => plain(value).split(/[^a-z0-9@._'-]+/).filter(Boolean);
const given = name => (plain(name).split(/[\s(),.]+/).find(part => /^[a-z][a-z'-]{1,}$/.test(part)) || null);
const containsWords = (text, phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
};
// How a copy names the prospect when it shows only a first name: the greeting, or a header the SDR typed.
const GREETED = /\b(?:hi|hey|hello|dear|thanks|thank you)\s+([a-z][a-z'-]{1,})\b|\bconversation with\s+([a-z][a-z'-]{1,})\b/g;

/**
 * Who among the people our outreach reached at this company is in the pasted
 * conversation. `people`: { name, email } at that company. A full name or an
 * address in the text is that person ('sure'). Failing that, a first name the
 * conversation greets that belongs to exactly one of them ('first name'); our own
 * side's names (`ours`: Piyush, Gaurav…) never count, since prospects greet them.
 */
export function peopleInPost(said, people, ours = []) {
  const text = plain(said);
  const exact = people.filter(p => (p.email && text.includes(plain(p.email)))
    || (p.name && words(p.name).length >= 2 && containsWords(text, words(p.name).join(' '))));
  if (exact.length) return { people: exact, how: 'name' };

  const own = new Set(ours.map(given).filter(Boolean));
  const greeted = new Set();
  for (const m of text.matchAll(GREETED)) {
    const name = m[1] || m[2];
    if (!own.has(name)) greeted.add(name);
  }
  const firstOf = p => (p.name ? given(p.name) : p.email ? plain(p.email).split('@')[0].split(/[._-]/)[0] : null);
  const byFirst = people.filter(p => greeted.has(firstOf(p)));
  // One person can be both an email lead and a replier: the address is who they are.
  const distinct = new Set(byFirst.map(p => (p.email ? plain(p.email) : plain(p.name))));
  return distinct.size === 1 ? { people: byFirst, how: 'first name' } : { people: [], how: null };
}
