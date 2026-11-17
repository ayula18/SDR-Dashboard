import { qp } from '../db.js';
import { isoDay, nextPeriod, periodStart, periodsBetween, toDay, today } from '../outreach/dates.js';
import { callActivity, callOutcomes, emailActivity, leadOutcomes, linkedinActivity } from './core.js';
import { dashStartDate, describeRange, fullPeriods } from './filters.js';
import { badRequest, callRates, emailRates, linkedinRates } from './format.js';
import { OUTCOME_AT, linkedinOutcomes } from './linkedin.js';
import { listMeetings } from './meetings.js';
import { bucket } from './sql.js';

/**
 * The outreach funnel per period and per SDR, the one source of the SDR page's table,
 * its day, week and month charts and the Overview's comparison:
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

/** How many full periods a chart shows. */
const WINDOW = { day: 20, week: 12, month: 12 };
// The jobs each channel's volumes come from; see readThrough.
const VOLUME_JOBS = { email: ['instantly-periods', 'heyreach'], call: ['nooks-calls'] };

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
  const email = emailRates(row.firstEmails, row.emailPositive, row.emailMeetings);
  const linkedin = linkedinRates(row.invitesSent, row.invitesAccepted, row.linkedinPositive, row.linkedinMeetings);
  const call = callRates(row.callsMade, row.callsConnected, row.conversations, row.callPositive, row.callMeetings);
  return {
    ...row,
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

async function funnelRows(filters, grain, periods) {
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

/** Everyone on the roster who has made a call, so an SDR is on the Call view from their first one. */
const dialers = async () => new Set((await qp(`SELECT DISTINCT sdr FROM dash_v_calls WHERE sdr IS NOT NULL`)).map(r => r.sdr));

/**
 * Who an SDR list shows: the SDRs, until someone is picked by name, and then exactly
 * those (Ayush, 2026-11-07). Everyone else's outreach still counts in every total.
 * The Call view shows the callers and any SDR who has dialed (Ayush, 2026-11-17: "my
 * old sdr will start calling a bit late, for now pranesh and yashika will be making
 * calls"); `dialed` is the set of those SDRs.
 */
export const shownSdrs = (team, picked, { channel = null, dialed = new Set() } = {}) => team.filter(t => {
  if (picked) return picked.includes(t.name);
  if (channel === 'call') return t.role === 'caller' || (t.role === 'sdr' && dialed.has(t.name));
  return t.role === 'sdr';
});

/**
 * The day the channel's volumes had last been read completely: both platforms for email
 * and LinkedIn, the Nooks dialer for calls. Anything before it was read after it ended,
 * so it is whole; a run that stops part-way leaves this where it was rather than
 * comparing a day whose evening nobody has read.
 */
async function readThrough(channel) {
  const jobs = VOLUME_JOBS[channel] || VOLUME_JOBS.email;
  const [row] = await qp(`SELECT min(last_success_at) AS at FROM dash_sync_state WHERE job = ANY($1::text[])`, [jobs]);
  return row?.at ? toDay(row.at) : today();
}

/** Who a list shows for this channel, as shownSdrs decides. */
async function shownFor(team, filters, channel) {
  const dialed = channel === 'call' && !filters.sdr ? await dialers() : new Set();
  return shownSdrs(team, filters.sdr, { channel, dialed });
}

/**
 * Each SDR's funnel for exactly the dates picked, with the total and what campaigns
 * outside the roster did. `channel` 'call' lists who calls instead of the SDRs.
 */
export async function getSdrBoard(filters, { channel = null } = {}) {
  const [team, rows] = await Promise.all([
    roster(),
    funnelRows(filters, 'day', periodsBetween('day', filters.from, filters.to)),
  ]);
  const shown = await shownFor(team, filters, channel);
  const names = new Set(shown.map(t => t.name));
  return {
    range: describeRange(filters),
    sdrs: shown.map(t => ({ name: t.name, color: t.color, ...sumFunnel(rows.filter(r => r.sdr === t.name)) })),
    total: sumFunnel(rows.filter(r => names.has(r.sdr))),
    others: sumFunnel(rows.filter(r => !names.has(r.sdr))),
  };
}

/**
 * The last full days, weeks or months (Ayush, 2026-11-06), the last two being what
 * day on day, week on week or month on month compares:
 *   everyone  all outreach the filters allow, what the Overview compares
 *   team      the SDRs shown together
 *   sdrs      each SDR shown
 */
export async function getFunnelTrend(filters, { grain = 'week', count = null, channel = null } = {}) {
  if (!WINDOW[grain]) throw badRequest(`Unknown grain "${grain}"`);
  const wanted = count == null ? WINDOW[grain] : Number(count);
  if (!(wanted >= 2 && wanted <= 60)) throw badRequest('"count" wants a number from 2 to 60');

  const [team, asOf] = await Promise.all([roster(), readThrough(channel)]);
  const first = isoDay(periodStart(grain, dashStartDate()));
  const periods = fullPeriods(grain, wanted, asOf).filter(period => period >= first);
  const [rows, shown] = await Promise.all([funnelRows(filters, grain, periods), shownFor(team, filters, channel)]);

  const names = new Set(shown.map(t => t.name));
  const perPeriod = test => periods.map(period => ({ period, ...sumFunnel(rows.filter(r => r.period === period && test(r))) }));
  return {
    grain,
    periods,
    everyone: perPeriod(() => true),
    team: perPeriod(r => names.has(r.sdr)),
    sdrs: shown.map(t => ({ name: t.name, color: t.color, rows: perPeriod(r => r.sdr === t.name) })),
  };
}
