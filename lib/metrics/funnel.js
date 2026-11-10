import { qp } from '../db.js';
import { isoDay, nextPeriod, periodStart, periodsBetween, toDay, today } from '../outreach/dates.js';
import { emailActivity, leadOutcomes, linkedinActivity } from './core.js';
import { dashStartDate, describeRange, fullPeriods } from './filters.js';
import { badRequest } from './format.js';
import { OUTCOME_AT, linkedinOutcomes } from './linkedin.js';
import { listMeetings } from './meetings.js';
import { bucket } from './sql.js';

/**
 * The outreach funnel per period and per SDR, the one source of the SDR page's table,
 * its day, week and month charts and the Overview's comparison:
 *   email     emails sent (follow-ups included), first emails, replies, positive, meetings
 *   linkedin  invites sent, invites accepted, first messages, replies, positive, meetings
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
  // Booked by an SDR with no campaign behind it, so neither channel can claim it.
  unplacedMeetings: 0,
};

/** How many full periods a chart shows. */
const WINDOW = { day: 20, week: 12, month: 12 };
// The two jobs the volumes come from; see readThrough.
const VOLUME_JOBS = ['instantly-periods', 'heyreach'];

/** The queries' rows as one row per period and SDR ('' for a campaign no SDR owns). Rows outside `periods` are dropped. */
export function mergeFunnel({ grain, periods, email, linkedin, emailOutcomeRows, linkedinOutcomeRows, meetings }) {
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
  for (const m of meetings) {
    const channel = m.platform === 'instantly' ? 'emailMeetings' : m.platform === 'heyreach' ? 'linkedinMeetings' : 'unplacedMeetings';
    // One row per credited SDR: a meeting the audit sheet splits is half each.
    add(isoDay(periodStart(grain, m.date)), m.sdr || '', { [channel]: Number(m.share ?? 1) });
  }
  return [...rows.values()];
}

/** Adds rows up into one set of numbers. */
export function sumFunnel(rows) {
  const total = { ...ZERO };
  for (const row of rows) for (const name of Object.keys(ZERO)) total[name] += row[name];
  return total;
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
  const [email, linkedin, emailOutcomeRows, linkedinOutcomeRows, meetings] = await Promise.all([
    emailActivity(filters, range, `a.period_start::text ${bySdr('c')}`),
    linkedinActivity(filters, range, `a.period_start::text ${bySdr('c')}`),
    leadOutcomes(filters, range, `${bucket(grain, OUTCOME_AT)} ${bySdr('l')}`),
    linkedinOutcomes(filters, range, `${bucket(grain, OUTCOME_AT)} ${bySdr('l')}`),
    listMeetings(filters, { from: range.from, toExclusive: range.toExclusive, withRescheduled: false, limit: 3000 }),
  ]);
  return mergeFunnel({ grain, periods, email, linkedin, emailOutcomeRows, linkedinOutcomeRows, meetings });
}

export const roster = () => qp(`SELECT name, color, role FROM dash_team WHERE is_active ORDER BY name`);

/**
 * Who an SDR list shows: the SDRs, until someone is picked by name, and then exactly
 * those (Ayush, 2026-11-07). Everyone else's outreach still counts in every total.
 */
export const shownSdrs = (team, picked) => team.filter(t => (picked ? picked.includes(t.name) : t.role === 'sdr'));

/**
 * The day both platforms had last been read completely. Anything before it was read
 * after it ended, so it is whole; a run that stops part-way leaves this where it was
 * rather than comparing a day whose evening nobody has read.
 */
async function readThrough() {
  const [row] = await qp(`SELECT min(last_success_at) AS at FROM dash_sync_state WHERE job = ANY($1::text[])`, [VOLUME_JOBS]);
  return row?.at ? toDay(row.at) : today();
}

/** Each SDR's funnel for exactly the dates picked, with the total and what campaigns outside the roster did. */
export async function getSdrBoard(filters) {
  const [team, rows] = await Promise.all([
    roster(),
    funnelRows(filters, 'day', periodsBetween('day', filters.from, filters.to)),
  ]);
  const shown = shownSdrs(team, filters.sdr);
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
export async function getFunnelTrend(filters, { grain = 'week', count = null } = {}) {
  if (!WINDOW[grain]) throw badRequest(`Unknown grain "${grain}"`);
  const wanted = count == null ? WINDOW[grain] : Number(count);
  if (!(wanted >= 2 && wanted <= 60)) throw badRequest('"count" wants a number from 2 to 60');

  const [team, asOf] = await Promise.all([roster(), readThrough()]);
  const first = isoDay(periodStart(grain, dashStartDate()));
  const periods = fullPeriods(grain, wanted, asOf).filter(period => period >= first);
  const rows = await funnelRows(filters, grain, periods);

  const shown = shownSdrs(team, filters.sdr);
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
