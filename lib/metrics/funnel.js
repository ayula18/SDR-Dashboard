import { qp } from '../db.js';
import { isoDay, nextPeriod, periodStart, periodsBetween, toDay, today } from '../outreach/dates.js';
import { callActivity, callOutcomes, emailActivity, leadOutcomes, linkedinActivity } from './core.js';
import { dashStartDate, periodColumns } from './filters.js';
import { badRequest, callRates, emailRates, linkedinRates } from './format.js';
import { OUTCOME_AT, linkedinOutcomes } from './linkedin.js';
import { listMeetings } from './meetings.js';
import { bucket } from './sql.js';

/**
 * The outreach funnel per period and per SDR, the one source of the SDR page's DoD, WoW
 * and MoM tables and the Overview's comparison:
 *   email     emails sent (follow-ups included), first emails, replies, positive, meetings
 *   linkedin  invites sent, invites accepted, first messages, replies, positive, meetings
 *   call      calls made, calls connected (a person picked up), conversations (60+ seconds),
 *             positive, meetings: the
 *             Nooks dialer (dash_v_calls), positives as the caller marked them
 * and, on every summed row, the channel rates the Overview's % cards show (emailRates,
 * linkedinRates, callRates), so a rate here and there is one definition.
 *
 * Every number comes from the same blocks the channel cards read, so a period here
 * and a range there cannot disagree. Outcomes count once on the day they landed, so
 * days add up to weeks and months exactly.
 */
const ZERO = {
  emailsSent: 0,
  firstEmails: 0,
  emailReplies: 0,
  emailPositive: 0,
  emailMeetings: 0,
  invitesSent: 0,
  invitesAccepted: 0,
  firstMessages: 0,
  linkedinReplies: 0,
  linkedinPositive: 0,
  linkedinMeetings: 0,
  callsMade: 0,
  callsConnected: 0,
  conversations: 0,
  callPositive: 0,
  callMeetings: 0,
  // Booked by an SDR on no channel anything shows: answered on Meeting checks.
  unplacedMeetings: 0,
};

/** How many full periods a table shows when no dates are picked. */
const WINDOW = { day: 20, week: 12, month: 12 };
// The jobs each channel's volumes come from; see readThrough. A channel's table waits only
// for its own; `all` (every channel together, SDR Detailed - Metrics' meetings card) for all three.
const VOLUME_JOBS = { all: ['instantly-periods', 'heyreach', 'nooks-calls'], email: ['instantly-periods'], linkedin: ['heyreach'], call: ['nooks-calls'] };

/** The queries' rows as one row per period and SDR ('' for a campaign no SDR owns). Rows outside `periods` are dropped. */
export function mergeFunnel({ grain, periods, email, linkedin, emailOutcomeRows, linkedinOutcomeRows, callRows = [], callOutcomeRows = [], meetings }) {
  const wanted = new Set(periods);
  const rows = new Map();
  const add = (period, sdr, numbers) => {
    if (!wanted.has(period)) return;
    const key = `${period}|${sdr}`;
    const row = rows.get(key) || { period, sdr, ...ZERO };
    for (const [name, value] of Object.entries(numbers)) row[name] += value;
    rows.set(key, row);
  };
  const addKeyed = (list, numbers) => {
    for (const r of list) {
      const at = r.key.indexOf('|');
      add(r.key.slice(0, at), r.key.slice(at + 1), numbers(r));
    }
  };

  addKeyed(email, r => ({ emailsSent: r.allSent, firstEmails: r.sent }));
  addKeyed(linkedin, r => ({ invitesSent: r.invitesSent, invitesAccepted: r.invitesAccepted, firstMessages: r.messagesSent }));
  addKeyed(emailOutcomeRows, r => ({ emailReplies: r.replied, emailPositive: r.positive }));
  addKeyed(linkedinOutcomeRows, r => ({ linkedinReplies: r.replied, linkedinPositive: r.positive }));
  addKeyed(callRows, r => ({ callsMade: r.callsMade, callsConnected: r.callsConnected, conversations: r.conversations }));
  addKeyed(callOutcomeRows, r => ({ callPositive: r.positive }));
  for (const m of meetings) {
    const channel = m.platform === 'instantly' ? 'emailMeetings' : m.platform === 'heyreach' ? 'linkedinMeetings'
      : m.outreachChannel === 'call' ? 'callMeetings' : 'unplacedMeetings';
    // One row per credited SDR: a meeting the audit sheet splits is half each.
    add(isoDay(periodStart(grain, m.date)), m.sdr || '', { [channel]: Number(m.share ?? 1) });
  }
  return [...rows.values()];
}

/**
 * The SDR page's rates from a row's counts (Ayush's manager, 2026-11-10): email per
 * first email, LinkedIn per invite sent, calls per call made. Rates are worked out from
 * the sums, never averaged, so a total row's rate is the team's.
 */
function withRates(row) {
  // Every meeting the people booked, whatever the channel, one definition for every total.
  const meetings = row.emailMeetings + row.linkedinMeetings + row.callMeetings + row.unplacedMeetings;
  const email = emailRates(row.firstEmails, row.emailPositive, row.emailMeetings);
  const linkedin = linkedinRates(row.invitesSent, row.invitesAccepted, row.linkedinPositive, row.linkedinMeetings);
  const call = callRates(row.callsMade, row.callsConnected, row.conversations, row.callPositive, row.callMeetings);
  return {
    ...row,
    meetings,
    emailPositiveRate: email.positiveRate,
    emailMeetingRate: email.meetingRate,
    acceptanceRate: linkedin.acceptanceRate,
    linkedinPositiveRate: linkedin.positiveRate,
    linkedinMeetingRate: linkedin.meetingRate,
    callConnectRate: call.connectRate,
    callTalkRate: call.talkRate,
    callPositiveRate: call.positiveRate,
    callMeetingRate: call.meetingRate,
  };
}

/** Adds rows up into one set of numbers, with the rates they make. */
export function sumFunnel(rows) {
  const total = { ...ZERO };
  for (const row of rows) for (const name of Object.keys(ZERO)) total[name] += row[name];
  return withRates(total);
}

export async function funnelRows(filters, grain, periods) {
  if (!periods.length) return [];
  const range = {
    grain,
    periods,
    from: periods[0],
    toExclusive: isoDay(nextPeriod(grain, periods[periods.length - 1])),
  };
  const bySdr = alias => `|| '|' || COALESCE(${alias}.sdr, '')`;
  const byDay = `${bucket(grain, OUTCOME_AT)} ${bySdr('l')}`;
  const [email, linkedin, emailOutcomeRows, linkedinOutcomeRows, callRows, callOutcomeRows, meetings] = await Promise.all([
    emailActivity(filters, range, `a.period_start::text ${bySdr('c')}`),
    linkedinActivity(filters, range, `a.period_start::text ${bySdr('c')}`),
    leadOutcomes(filters, range, byDay),
    linkedinOutcomes(filters, range, byDay),
    callActivity(filters, range, byDay),
    callOutcomes(filters, range, byDay),
    listMeetings(filters, { from: range.from, toExclusive: range.toExclusive, withRescheduled: false, limit: 3000 }),
  ]);
  return mergeFunnel({ grain, periods, email, linkedin, emailOutcomeRows, linkedinOutcomeRows, callRows, callOutcomeRows, meetings });
}

export const roster = () => qp(`SELECT name, color, role FROM dash_team WHERE is_active ORDER BY name`);

/**
 * Who an SDR list shows: the SDRs, until someone is picked by name, and then exactly
 * those (Ayush, 2026-11-07). Everyone else's outreach still counts in every total.
 * Calls, and `all` (every channel at once), show the SDRs and the callers (Ayush,
 * 2026-11-17: "in calls lets put the sdrs not just pranesh and yashika").
 */
export const shownSdrs = (team, picked, { channel = null } = {}) => team.filter(t => {
  if (picked) return picked.includes(t.name);
  if (channel === 'call' || channel === 'all') return t.role === 'sdr' || t.role === 'caller';
  return t.role === 'sdr';
});

/**
 * When the channel's volumes were last read completely (`readAt`) and that day (`asOf`):
 * Instantly for email, HeyReach for LinkedIn, the Nooks dialer for calls, all three for
 * `all`. Anything before `asOf` was read after it ended, so it is whole; a run that stops
 * part-way leaves this where it was rather than comparing a day whose evening nobody has
 * read. Today so far is only what was read by `readAt`.
 */
async function readThrough(channel) {
  const jobs = VOLUME_JOBS[channel] || VOLUME_JOBS.all;
  const [row] = await qp(`SELECT min(last_success_at) AS at FROM dash_sync_state WHERE job = ANY($1::text[])`, [jobs]);
  return row?.at ? { asOf: toDay(row.at), readAt: new Date(row.at).toISOString() } : { asOf: today(), readAt: null };
}

/**
 * A column per day, week or month (periodColumns): with no dates picked the last full
 * ones (Ayush, 2026-11-06), the last two being what day on day, week on week or month on
 * month compares; with dates picked, the periods inside them; with `toDate`, today so far
 * (DoD only), WTD and MTD after them, as of `readAt`. Every column is the sum of its days, read once for the whole span, so a
 * period cut short by the dates and a running week count exactly their own days. (Day
 * rows add up to the stored week and month rows: every month of 2026 on both platforms,
 * checked 2026-11-17.)
 *   columns   each column's { period, from, to, kind }
 *   everyone  all outreach the filters allow, what the Overview compares
 *   team      the SDRs shown together
 *   sdrs      each SDR shown
 */
export async function getFunnelTrend(filters, { grain = 'week', count = null, channel = null, picked = null, toDate = false } = {}) {
  if (!WINDOW[grain]) throw badRequest(`Unknown grain "${grain}"`);
  const wanted = count == null ? WINDOW[grain] : Number(count);
  if (!(wanted >= 2 && wanted <= 60)) throw badRequest('"count" wants a number from 2 to 60');

  const [team, { asOf, readAt }] = await Promise.all([roster(), readThrough(channel)]);
  const columns = periodColumns(grain, { picked, count: wanted, asOf, toDate, first: dashStartDate() });
  const from = columns.reduce((min, c) => (c.from < min ? c.from : min), columns[0]?.from);
  const to = columns.reduce((max, c) => (c.to > max ? c.to : max), columns[0]?.to);
  const rows = columns.length ? await funnelRows(filters, 'day', periodsBetween('day', from, to)) : [];
  const shown = shownSdrs(team, filters.sdr, { channel });

  const names = new Set(shown.map(t => t.name));
  const perColumn = test => columns.map(c => ({
    period: c.period,
    ...sumFunnel(rows.filter(r => r.period >= c.from && r.period <= c.to && test(r))),
  }));
  return {
    grain,
    periods: columns.map(c => c.period),
    columns,
    readAt,
    everyone: perColumn(() => true),
    team: perColumn(r => names.has(r.sdr)),
    sdrs: shown.map(t => ({ name: t.name, color: t.color, rows: perColumn(r => r.sdr === t.name) })),
  };
}
