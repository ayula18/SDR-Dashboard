/**
 * The SDRs' positive response sheet, read as a list of positives.
 *
 * WHY THE SHEET DECIDES (Ayush, 2026-11-05): SDRs log every positive reply by
 * hand and that log is the ground truth for their campaigns. AI SDR and other
 * campaigns nobody logs stay on our reply labels. The reply text is not in the
 * sheet, so each row is tied back to a person here, and from them to what they
 * wrote and to the campaign that reached them.
 *
 * Two tabs, one list: the old tracker (2024 to early July 2026) and the "Positive
 * responses" tab of the assignment sheet since then.
 *
 * Pure, so it is tested without Google or a database: the job in
 * lib/sync/jobs/positive-sheet.js reads the inputs and writes the output.
 */

import { addDays, isoDay, today, toDay } from './dates.js';
import { normalizeDomain } from './domains.js';
import { companyKey } from './linkedin.js';

export const POSITIVE_SHEETS = {
  old: {
    id: '1ePM1vFBDqZaDZgU9h9cSGe7UyJwDTUISi548626u60g',
    tab: 'Responses - 2024',
    fields: {
      name: 'Name', company: 'Company', domain: 'Domain', sdr: 'SDR?', followup: 'Followup', platform: 'Platform',
      sender: 'Email/LI', reply: 'Reply date', fu1: 'FU 1', lastFu: 'Last FU date', status: 'Status',
      notes: 'Next steps', comments: 'Comments', mark: 'Neutral/Positive',
    },
  },
  current: {
    id: process.env.ASSIGNMENT_SHEET_ID || '1Kq6wbB6ioMKxyPU8zEkHQNT3fe-znEZXq0fxoQwc3JM',
    tab: 'Positive responses',
    fields: {
      name: 'Name', domain: 'Domain', week: 'WS', sdr: 'SDR?', platform: 'Platform', sender: 'Email/LI',
      reply: 'Reply date', fu1: 'FU 1', status: 'Status', notes: 'Context', comments: 'Next possible step',
    },
  },
};

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Column positions by header text, so an inserted column shifts nothing and a
 * renamed one fails the run loudly instead of quietly filling the wrong field.
 * The last match wins: the old tab has two "Next steps" columns and only the later
 * one is used.
 */
export function columnsOf(header, fields, tab) {
  const cells = header.map(h => clean(h).toLowerCase());
  const columns = {};
  for (const [field, name] of Object.entries(fields)) {
    const at = cells.lastIndexOf(name.toLowerCase());
    if (at < 0) throw new Error(`"${tab}" has no "${name}" column`);
    columns[field] = at;
  }
  return columns;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "Sep-11", "Sept-23", "Apr 2" → { month, day }. Null for anything else. */
export function monthDay(value) {
  const match = clean(value).match(/^([A-Za-z]{3})[a-z]*[\s-]+(\d{1,2})$/);
  const month = match && MONTHS[match[1].toLowerCase()];
  if (month === undefined || month === null) return null;
  const day = Number(match[2]);
  return day >= 1 && day <= 31 ? { month, day } : null;
}

const onYear = (year, { month, day }) => isoDay(new Date(Date.UTC(year, month, day)));
const daysApart = (a, b) => Math.round((toDay(a) - toDay(b)) / 86_400_000);

/**
 * The sheet writes dates with no year. Rows go down in time, so a date belongs to
 * the one year that puts it within ten months behind the latest row or two months
 * ahead of it: exactly one year fits. Checked against the dashboard's own reply
 * dates: 170 of 193 people land within a day.
 */
export function placeYear(md, anchor) {
  const year = toDay(anchor).getUTCFullYear();
  for (const y of [year - 1, year, year + 1]) {
    const date = onYear(y, md);
    const ahead = daysApart(date, anchor);
    if (ahead > -300 && ahead <= 65) return date;
  }
  return onYear(year, md);
}

function closestYear(md, near) {
  const year = toDay(near).getUTCFullYear();
  return [year - 1, year, year + 1].map(y => onYear(y, md))
    .sort((a, b) => Math.abs(daysApart(a, near)) - Math.abs(daysApart(b, near)))[0];
}

/** An empty date cell the sheet formats as a date reads "Dec-30" (day zero of 1899). */
const EMPTY_DATE_CELL = 'Dec-30';
const OLD_TAB_STARTS = '2024-08-15';
const CURRENT_TAB_STARTS = '2026-06-15';
/** The first follow-up answers the reply, so a reply dated later than this after it is a typo. */
const REPLY_AFTER_FOLLOWUP_DAYS = 2;

const asRows = (values, { fields, tab }) => {
  const [header = [], ...rows] = values;
  const columns = columnsOf(header, fields, tab);
  return rows.map((cells, i) => ({
    sheetRow: i + 2,
    ...Object.fromEntries(Object.entries(columns).map(([field, at]) => [field, clean(cells[at])])),
  }));
};

const channelOf = platform => (/link|lined/i.test(platform) ? 'linkedin' : /mail/i.test(platform) ? 'email' : null);

/** The old tab: rows run from 2024 down to July 2026. Its "Week starting" column says 2025 for 2026 rows, so it is not read. */
export function parseOldTab(values) {
  const rows = [];
  let anchor = OLD_TAB_STARTS;
  for (const r of asRows(values, POSITIVE_SHEETS.old)) {
    if (!r.name && !r.company) continue;
    const reply = monthDay(r.reply);
    const md = reply || monthDay(r.fu1) || (r.lastFu === EMPTY_DATE_CELL ? null : monthDay(r.lastFu));
    // A row with no date at all sits among the rows around it, so it takes their date.
    const repliedOn = md ? placeYear(md, anchor) : anchor;
    if (repliedOn > anchor) anchor = repliedOn;
    rows.push({
      tab: 'old', sheetRow: r.sheetRow, personName: r.name, companyName: r.company || null, domainRaw: r.domain || null,
      sdrRaw: r.sdr || r.followup || null, channel: channelOf(r.platform), sender: r.sender || null,
      repliedOn, dateSource: reply ? 'reply' : md ? 'followup' : 'position',
      status: r.status || null, notes: r.notes || null, comments: r.comments || null, mark: r.mark || null,
    });
  }
  return rows;
}

/**
 * The current tab. Every row carries the week its outreach began ("WS"), which
 * places its year better than its order alone: rows moved from the old tab sit
 * among newer ones. A reply can come long after that week (Jul-27, then Sep-24), so
 * the reply date stands unless it is impossible: in the future, or after the row's
 * own first follow-up ("Nov-26" on a row followed up on Aug-20).
 */
export function parseCurrentTab(values, now = today()) {
  const rows = [];
  const todayIso = isoDay(now);
  let anchor = CURRENT_TAB_STARTS;
  for (const r of asRows(values, POSITIVE_SHEETS.current)) {
    if (!r.name && !r.domain) continue;
    const weekMd = monthDay(r.week);
    const week = weekMd ? placeYear(weekMd, anchor) : null;
    if (week && week > anchor && week <= todayIso) anchor = week;
    const near = week || anchor;
    const placed = md => {
      const date = md ? closestYear(md, near) : null;
      return date && date <= todayIso ? date : null;
    };
    const followup = placed(monthDay(r.fu1));
    const writtenReply = placed(monthDay(r.reply));
    const reply = writtenReply && followup && daysApart(writtenReply, followup) > REPLY_AFTER_FOLLOWUP_DAYS ? null : writtenReply;
    rows.push({
      tab: 'current', sheetRow: r.sheetRow, personName: r.name, companyName: null, domainRaw: r.domain || null,
      sdrRaw: r.sdr || null, channel: channelOf(r.platform), sender: r.sender || null,
      repliedOn: reply || followup || (week && week <= todayIso ? week : null),
      dateSource: reply ? 'reply' : followup ? 'followup' : week ? 'week' : 'none',
      status: r.status || null, notes: r.notes || null, comments: r.comments || null, mark: null,
    });
  }
  return rows;
}

/** "Toby + George", "Esther and Brian" → ['toby', 'george'] … one row can name several people. */
export function firstNames(name) {
  return clean(name).toLowerCase().split(/\s*(?:\+|&|,|\/|\band\b)\s*/)
    .map(part => part.split(/[\s(]+/)[0].replace(/[^a-z]/g, ''))
    .filter(part => part.length >= 2);
}

const looksLikeDomain = value => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(clean(value));
const flat = value => String(value ?? '').replace(/[^a-z0-9]/g, '');
const rootOf = domain => flat(String(domain).split('.')[0]);

/** Everything a row's company might be spelled as, for telling two rows are the same company. */
export function companySpellings({ companyName, domainRaw }) {
  const spellings = new Set();
  for (const value of [companyName, domainRaw]) {
    if (!value) continue;
    if (looksLikeDomain(value)) {
      const domain = normalizeDomain(value) || value.toLowerCase();
      spellings.add(rootOf(domain));
      spellings.add(flat(domain)); // realm.security is "Realm Security", not "realm"
    } else {
      const key = companyKey(value);
      if (key) spellings.add(flat(key));
      spellings.add(flat(clean(value).toLowerCase()));
    }
  }
  spellings.delete('');
  return spellings;
}

const sameCompany = (a, b) => [...companySpellings(a)].some(s => companySpellings(b).has(s));
const samePerson = (a, b) => firstNames(a.personName).some(n => firstNames(b.personName).includes(n));

/**
 * One list out of two tabs. A row moved from the old tab to the current one is one
 * positive: it keeps the day it came in and takes the current tab's status. The
 * same person logged again months later is a new positive and counts again (40
 * people in the old tab, often with another SDR or on another channel).
 */
export function mergeTabs(oldRows, currentRows) {
  const merged = oldRows.map(r => ({ ...r }));
  const out = [];
  for (const row of currentRows) {
    const moved = merged.find(o => !o.foldedInto && samePerson(o, row) && sameCompany(o, row) && (
      /moved/i.test(o.status || '') || (o.repliedOn && row.repliedOn && Math.abs(daysApart(o.repliedOn, row.repliedOn)) <= 14)
    ));
    if (!moved) { out.push(row); continue; }
    moved.foldedInto = row.sheetRow;
    out.push({
      ...row,
      companyName: moved.companyName,
      repliedOn: moved.repliedOn || row.repliedOn,
      dateSource: moved.repliedOn ? moved.dateSource : row.dateSource,
      sdrRaw: row.sdrRaw || moved.sdrRaw,
      mark: moved.mark,
    });
  }
  return [...merged.filter(o => !o.foldedInto), ...out];
}

const NOT_OUTREACH = /^(inbound|referr?al)$/i;
// Blanks, and the signal a row came from written where its SDR goes.
const NOT_A_PERSON = /^(na|n\/a|-+|\?+|koala|job change)$/i;
// Where the SDR who logged a row wrote that it is not a positive. Nothing softer
// counts: "unlikely to book" or a status of "not interested" is what happened later,
// not what the reply was.
const SDR_SAID_NOT_POSITIVE = /\bnot positive\b|\bneutral\b|\bnegative (reply|response)\b|\(not count|\bnot counting\b/i;
const MARKED_NOT_POSITIVE = /neutral|negative/i;

/** Who the sheet credits, spelled as on the team list. A former SDR keeps their name; no name means unattributed. */
export function sdrName(raw, team) {
  const name = clean(raw).replace(/\(.*?\)/g, '').replace(/\?+$/, '').trim();
  if (!name || NOT_A_PERSON.test(name)) return null;
  const lower = name.toLowerCase();
  const member = team.find(t => t.name.toLowerCase() === lower || (t.aliases || []).includes(lower));
  return member ? member.name : name;
}

/** Why a row does not count as a positive. Null for almost every row. */
export function skipReason(row) {
  if (NOT_OUTREACH.test(clean(row.sdrRaw))) return 'not outreach';
  if (MARKED_NOT_POSITIVE.test(row.mark || '')) return `marked ${clean(row.mark).toLowerCase()}`;
  if (SDR_SAID_NOT_POSITIVE.test([row.notes, row.comments, row.status].filter(Boolean).join(' '))) return 'SDR note says not positive';
  if (!row.repliedOn) return 'no date';
  if (!row.channel) return 'no channel';
  return null;
}

/** Which domain a row's company is: what the sheet wrote, else what its name resolves to. Null when nothing says. */
export function resolveDomain(row, { canonical, emailedByName, linkedinByName, outreachRoots, registryByName }) {
  const canon = domain => (domain ? canonical.get(domain) || domain : null);
  for (const value of [row.domainRaw, row.companyName]) {
    if (looksLikeDomain(value)) return canon(normalizeDomain(value));
  }
  const name = row.companyName || row.domainRaw;
  const key = companyKey(name);
  if (!key) return null;
  if (emailedByName.has(key)) return canon(emailedByName.get(key));
  if (linkedinByName.has(key)) return canon(linkedinByName.get(key));
  const root = outreachRoots.get(flat(key));
  if (root) return canon(root);
  const registered = registryByName.get(key);
  return registered?.length === 1 ? canon(registered[0]) : null;
}

const ONE_TYPO = (a, b) => {
  if (a === b) return true;
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};

/** Does this first name belong to this person? An email only has its local part to go on; a typo is forgiven ("Loana" is Ioana). */
export function nameMatches(first, person) {
  if (person.email) {
    const local = person.email.split('@')[0].toLowerCase();
    const head = local.split(/[._-]/)[0];
    return ONE_TYPO(first, head) || (first.length >= 3 && local.startsWith(first));
  }
  return givenNames(person.name).some(own => ONE_TYPO(first, own));
}

/** "R. Brad Kirn", "Gina (Madura) Pohl": the first two names long enough to be one. */
const givenNames = name => clean(name).toLowerCase().split(/[\s(),.]+/)
  .map(part => part.replace(/[^a-z]/g, ''))
  .filter(part => part.length >= 2)
  .slice(0, 2);

/**
 * Could this be the person, going by what little the address or profile shows?
 * Emails hide names (pbarkett@ is Phil, kfoon@ is Kirsten), so a reply near the
 * day settles it, but only from someone the name could belong to: pam.bragan@
 * replying that week is not Scott, and her words must not show under his name.
 */
export function initialFits(first, person) {
  if (person.email) {
    const local = person.email.split('@')[0].toLowerCase();
    return local[0] === first[0] || (first.length >= 3 && local.includes(first));
  }
  const own = givenNames(person.name)[0];
  return Boolean(own) && own[0] === first[0];
}

const TOUCH_GRACE_DAYS = 3;
/** A reply this close to the row's date, on the same channel, can be the reply it logged. */
const SAME_REPLY_DAYS = 14;

const closestReply = (person, date) => (person.replyDates || [])
  .map(at => Math.abs(daysApart(at, date)))
  .sort((a, b) => a - b)[0] ?? Infinity;

/**
 * The campaign credit goes to: only one the SDR team owns, not excluded, and one
 * that had reached this person by then. Someone first added in 2026 cannot be the
 * result of a 2025 reply that same name sent.
 *
 * Where labels decide (HuggingFace and WVI for now, AI SDR, anyone who does not log),
 * a lead labelled positive near the row's date takes the row, whoever owns it. Any
 * other credit would count one reply twice: the row there and the label here (Mike at
 * Extend, logged by Harshini, labelled in Dheeraj's HuggingFace campaign; Pallav at
 * Emphere, logged by Harshini, labelled in Muni's). The sheet's SDR keeps the positive.
 */
function creditable(people, row) {
  const latest = isoDay(addDays(row.repliedOn, TOUCH_GRACE_DAYS));
  const labelled = p => !p.fromSheet && p.labelledPositive && closestReply(p, row.repliedOn) <= SAME_REPLY_DAYS;
  return people
    .filter(p => p.campaignId && p.leadId && (p.sdrLogs || labelled(p)) && !p.excluded && (!p.touchedOn || p.touchedOn <= latest))
    .sort((a, b) =>
      Number(labelled(b)) - Number(labelled(a))
      || Number(b.sdr === row.sdr) - Number(a.sdr === row.sdr)
      || closestReply(a, row.repliedOn) - closestReply(b, row.repliedOn)
      || String(b.touchedOn || '').localeCompare(String(a.touchedOn || '')))[0] || null;
}

const identity = person => ({ personEmail: person.email || null, linkedinId: person.linkedinId || null });

/**
 * Who a row is about, strongest first:
 *   person         the same first name at the company, on the row's channel
 *   company_reply  someone at the company the name could belong to replied on that
 *                  channel within 14 days ("Kirsten" is kfoon@)
 *   other_channel  the same first name on the other channel: their words, no credit
 *   company        we know the company and nobody at it fits
 *   none           we do not know the company either
 *
 * Whatever comes back, the row counts as that SDR's positive. This only decides
 * which words to show and which campaign gets credit, and a row with neither
 * still counts for the SDR and the totals.
 */
export function matchRow(row, peopleAt) {
  const empty = { matchKind: row.companyDomain ? 'company' : 'none', personEmail: null, linkedinId: null, campaignId: null, leadId: null };
  if (!row.repliedOn || !row.channel) return empty;

  const here = peopleAt(row);
  const same = here.filter(p => p.channel === row.channel);
  const names = firstNames(row.personName);
  const named = people => people.filter(p => names.some(n => nameMatches(n, p)));

  const person = named(same);
  if (person.length) {
    const credit = creditable(person, row);
    return { ...empty, matchKind: 'person', ...identity(credit || person[0]), campaignId: credit?.campaignId || null, leadId: credit?.leadId || null };
  }

  const repliedNear = same
    .filter(p => closestReply(p, row.repliedOn) <= SAME_REPLY_DAYS && names.some(n => initialFits(n, p)))
    .sort((a, b) => closestReply(a, row.repliedOn) - closestReply(b, row.repliedOn));
  if (repliedNear.length) {
    const credit = creditable(repliedNear, row);
    return { ...empty, matchKind: 'company_reply', ...identity(credit || repliedNear[0]), campaignId: credit?.campaignId || null, leadId: credit?.leadId || null };
  }

  const elsewhere = named(here.filter(p => p.channel !== row.channel));
  if (elsewhere.length) return { ...empty, matchKind: 'other_channel', ...identity(elsewhere[0]) };

  return here.length ? { ...empty, matchKind: 'company' } : empty;
}

/** A booking this close after a logged positive, or this close before one, is the same conversation. */
const COVERED_AFTER_LOGGED_DAYS = 180; // the window dash_v_meetings attributes outreach over
const COVERED_BEFORE_LOGGED_DAYS = 60;
/** The reply that led to a booking is looked for this far before the meeting. */
const REPLY_BEFORE_MEETING_DAYS = 60;

/** "Data Dog" is datadoghq.com and "Spur.dev" is tryspur.dev; "Coder" is not coderabbit.ai. */
const NEARLY_THE_SAME = (a, b) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short === long || (short.length >= 5 && long.includes(short) && short.length / long.length >= 0.7);
};
const looselySameCompany = (a, b) => {
  const theirs = [...companySpellings(b)];
  return [...companySpellings(a)].some(x => x.length >= 4 && theirs.some(y => y.length >= 4 && NEARLY_THE_SAME(x, y)));
};

const fmtDay = day => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The second rung of the waterfall behind an SDR's positives (Ayush, 2026-11-05).
 * SDRs do not log a reply that booked straight away: Ahmed, on Concordium, "they
 * booked directly on the same day - no point in putting those in +ve response sheet".
 * So an SDR-booked meeting at a company with nothing logged around it is a positive
 * too, dated by the reply that led to it, else the day the form's deal was made when
 * that can be the booking, else by the meeting.
 *
 * It must never count a conversation twice, so a meeting adds nothing when any of
 * these already speaks for it:
 *   a counted sheet row at that company, under any spelling of it
 *   a sheet row from the same SDR naming whoever replied, on another domain of theirs
 *     (Tal at nanoclaw.dev is tal@nanoco.ai, Shehin at keywordsai.co is shehin@respan.ai)
 *   a reply our labels already count, where labels decide
 *   an earlier booking at that company: a second call is not a second positive
 *
 * `meetings`: { domain, company, date, bookedOn, sdr, campaignSdr, campaignId, channel }, only ones
 * an SDR booked. `peopleAt` is the job's: leads at a company with their `replies`, and
 * anyone else there who wrote back, who can date the row and show their words but,
 * having no lead, takes no campaign credit.
 */
export function bookedPositives(meetings, rows, peopleAt) {
  const logged = rows.filter(r => !r.skipReason && r.repliedOn);
  const booked = [];
  for (const m of [...meetings].sort((a, b) => a.date.localeCompare(b.date))) {
    const company = { companyName: m.company || null, domainRaw: m.domain || null };
    const here = peopleAt({ companyDomain: m.domain, companyKey: companyKey(m.company || m.domain || '') }).filter(p => !p.excluded);
    const nearMeeting = reply => {
      const before = daysApart(m.date, reply.day);
      return before >= -1 && before <= REPLY_BEFORE_MEETING_DAYS;
    };

    if (here.some(p => !p.fromSheet && p.labelledPositive && (p.replies || []).some(nearMeeting))) continue;

    // Someone in two campaigns replied through one of them, and that one gets the credit.
    const cameThrough = r => Boolean(r.campaign) && r.campaign === r.person.campaignRef;
    const reply = here
      .flatMap(person => (person.replies || []).filter(r => nearMeeting(r) && !r.negative).map(r => ({ ...r, person })))
      .filter(r => !r.person.touchedOn || r.person.touchedOn <= isoDay(addDays(r.day, TOUCH_GRACE_DAYS)))
      .sort((a, b) =>
        Number(b.positive) - Number(a.positive)
        || a.day.localeCompare(b.day)
        || Number(cameThrough(b)) - Number(cameThrough(a))
        || Number(b.person.campaignId === m.campaignId) - Number(a.person.campaignId === m.campaignId))[0] || null;
    const lead = reply?.person || null;
    const sdr = m.sdr || lead?.sdr || m.campaignSdr || null;
    const campaignId = lead?.campaignId || m.campaignId || null;
    const channel = lead?.channel || m.channel || null;
    if (!channel || (!sdr && !campaignId)) continue;

    const sameConversation = (other, gap) => gap >= -COVERED_BEFORE_LOGGED_DAYS && gap <= COVERED_AFTER_LOGGED_DAYS
      && ((m.domain && other.companyDomain === m.domain) || looselySameCompany(other, company));
    const covered = logged.some(r => {
      const gap = daysApart(m.date, r.repliedOn);
      if (sameConversation(r, gap)) return true;
      return Boolean(lead) && r.sdr === sdr && gap >= -SAME_REPLY_DAYS && gap <= REPLY_BEFORE_MEETING_DAYS
        && firstNames(r.personName).some(n => nameMatches(n, lead));
    }) || booked.some(b => sameConversation(b, daysApart(m.date, b.meetingOn)));
    if (covered) continue;

    booked.push({
      key: `booked:${m.domain || flat(clean(m.company).toLowerCase())}:${m.date}`,
      tab: 'meeting', sheetRow: 0, personName: lead ? lead.name || lead.email : null, companyName: m.company || null,
      domainRaw: null, companyDomain: m.domain || null, sdrRaw: null, sdr, channel, sender: null,
      repliedOn: reply?.day || m.bookedOn || m.date, dateSource: reply ? 'reply' : m.bookedOn ? 'booking' : 'meeting', meetingOn: m.date,
      status: 'Booked', notes: `Meeting on ${fmtDay(m.date)}`, comments: null, mark: null, skipReason: null,
      matchKind: lead ? 'person' : 'company', ...(lead ? identity(lead) : { personEmail: null, linkedinId: null }),
      campaignId, leadId: lead?.leadId || null,
    });
  }
  return booked;
}

/**
 * A key that survives rows being inserted above it. Two rows with the same person,
 * company and day are one positive logged twice. A booked row already carries its own.
 */
export const rowKey = row => row.key || [
  firstNames(row.personName)[0] || flat(clean(row.personName).toLowerCase()) || `row${row.sheetRow}`,
  [...companySpellings(row)].sort()[0] || 'unknown',
  row.repliedOn || `row${row.sheetRow}`,
].join(':');
