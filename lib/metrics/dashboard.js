import { isoDay, nextPeriod, periodStart, toDay } from '../outreach/dates.js';
import { emailActivity, leadOutcomes, linkedinActivity, recentReplies } from './core.js';
import { companyPanel } from './companies.js';
import { describeRange, trailingPeriods } from './filters.js';
import { change, rate } from './format.js';
import { LI_REPLY_AT, linkedinOutcomes } from './linkedin.js';
import { groupMeetings, listMeetings, totalsFromMeetings } from './meetings.js';
import { changesAgainst, emailCard, linkedinCard } from './programs.js';
import { bucket } from './sql.js';
import { getTrendSeries } from './trends.js';

export const DASHBOARD_CHANNELS = ['both', 'email', 'linkedin'];
const PLATFORM = { email: 'instantly', linkedin: 'heyreach' };
// How many meetings one page can show; the dashboard reads the whole window at once.
const MEETING_LIMIT = 3000;

const zeroRow = key => ({
  key,
  emailsSent: 0,
  peopleEmailed: 0,
  emailReplied: 0,
  emailPositive: 0,
  invitesSent: 0,
  invitesAccepted: 0,
  messagesSent: 0,
  linkedinReplied: 0,
  linkedinPositive: 0,
  meetings: 0,
  meetingsHeld: 0,
});

/** One row per SDR or per program: what went out on each channel, what came back, and the meetings it got. */
function groupRows({ emails, emailReplies, invites, linkedinReplies, meetings }) {
  const rows = new Map();
  const row = key => {
    if (!rows.has(key)) rows.set(key, zeroRow(key));
    return rows.get(key);
  };
  for (const r of emails) Object.assign(row(r.key), { emailsSent: r.sent, peopleEmailed: r.leadsContacted });
  for (const r of emailReplies) Object.assign(row(r.key), { emailReplied: r.replied, emailPositive: r.positive });
  for (const r of invites) Object.assign(row(r.key), { invitesSent: r.invitesSent, invitesAccepted: r.invitesAccepted, messagesSent: r.messagesSent });
  for (const r of linkedinReplies) Object.assign(row(r.key), { linkedinReplied: r.replied, linkedinPositive: r.positive });
  for (const r of meetings) Object.assign(row(r.key), { meetings: r.meetings, meetingsHeld: r.held });

  return [...rows.values()]
    .map(r => ({
      ...r,
      touches: r.emailsSent + r.invitesSent + r.messagesSent,
      replies: r.emailReplied + r.linkedinReplied,
      positive: r.emailPositive + r.linkedinPositive,
    }))
    .filter(r => r.touches || r.replies || r.meetings)
    .sort((a, b) => b.positive - a.positive || b.meetings - a.meetings || b.touches - a.touches);
}

/**
 * The whole outreach effort on one page, in the same shape as a program page:
 *   companies  every company the filtered outreach touched in the range, counted
 *              as a funnel, with the ones that replied or met listed
 *   email      what went out on Instantly and came back in the range
 *   linkedin   the same on HeyReach
 *   meetings   booked and held in the range, and where they came from
 * plus a 12-period trend, the SDRs and programs behind it, and the latest replies.
 *
 * `channel` (both | email | linkedin) narrows all of it, meetings included: on
 * one channel only the meetings credited to that channel's campaigns are counted,
 * so meetings with no campaign match drop out.
 */
export async function getDashboard(filters, { channel = 'both' } = {}) {
  const view = DASHBOARD_CHANNELS.includes(channel) ? channel : 'both';
  const email = view !== 'linkedin';
  const linkedin = view !== 'email';
  const platform = PLATFORM[view] || null;
  const f = filters;
  const prev = f.previous;

  const grain = f.trendGrain;
  const periods = trailingPeriods(grain, f.to, 12);
  const trendRange = { grain, periods, from: periods[0], toExclusive: isoDay(nextPeriod(grain, periods[periods.length - 1])) };
  // The dashboard counts the team's own meetings: outbound, plus anything a campaign is credited with.
  const meetingOpts = { outboundOnly: true, platform };
  const key = alias => `COALESCE(${alias}.sdr, 'Unattributed')`;
  const programKey = alias => `COALESCE(${alias}.program, 'none')`;
  const none = value => Promise.resolve(value);
  // One read covers the range, the range before it and the 12 trend periods.
  const meetingsFrom = [prev.from, periods[0], f.from].sort()[0];

  const [
    panel, panelPrev,
    emailNow, emailRepliesNow, emailPrev, emailRepliesPrev,
    linkedinNow, linkedinRepliesNow, linkedinPrev, linkedinRepliesPrev,
    trend, linkedinTrend, meetingRows,
    sdrEmail, sdrEmailReplies, sdrLinkedin, sdrLinkedinReplies,
    programEmail, programEmailReplies, programLinkedin, programLinkedinReplies,
    replies,
  ] = await Promise.all([
    companyPanel(f, { from: f.from, toExclusive: f.toExclusive, channel: view }),
    companyPanel(f, { from: prev.from, toExclusive: prev.toExclusive, channel: view, withCompanies: false }),

    email ? emailActivity(f, f) : none(null),
    email ? leadOutcomes(f, f) : none(null),
    email ? emailActivity(f, prev) : none(null),
    email ? leadOutcomes(f, prev) : none(null),

    linkedin ? linkedinActivity(f, f) : none(null),
    linkedin ? linkedinOutcomes(f, f) : none(null),
    linkedin ? linkedinActivity(f, prev) : none(null),
    linkedin ? linkedinOutcomes(f, prev) : none(null),

    getTrendSeries(f, { grain, periods, withMeetings: false }),
    linkedin ? linkedinOutcomes(f, trendRange, bucket(grain, LI_REPLY_AT)) : none([]),
    // The meetings view is the slowest thing on the page, so it is read once for
    // the range, the one before it and the trend, and counted in JS from there.
    listMeetings(f, { ...meetingOpts, from: meetingsFrom, toExclusive: f.toExclusive, limit: MEETING_LIMIT }),

    email ? emailActivity(f, f, key('c')) : none([]),
    email ? leadOutcomes(f, f, key('l')) : none([]),
    linkedin ? linkedinActivity(f, f, key('c')) : none([]),
    linkedin ? linkedinOutcomes(f, f, key('l')) : none([]),

    email ? emailActivity(f, f, programKey('c')) : none([]),
    email ? leadOutcomes(f, f, programKey('l')) : none([]),
    linkedin ? linkedinActivity(f, f, programKey('c')) : none([]),
    linkedin ? linkedinOutcomes(f, f, programKey('l')) : none([]),

    recentReplies(f, { limit: 20, from: f.from, toExclusive: f.toExclusive, channel: view }),
  ]);

  const emailNumbers = email ? emailCard(emailNow, emailRepliesNow) : null;
  const linkedinNumbers = linkedin ? linkedinCard(linkedinNow, linkedinRepliesNow) : null;

  const inRange = (rows, from, toExclusive) => rows.filter(r => r.date && r.date >= from && r.date < toExclusive);
  const meetingsNow = inRange(meetingRows, f.from, f.toExclusive);
  const mtg = totalsFromMeetings(meetingsNow);
  const mtgPrev = totalsFromMeetings(inRange(meetingRows, prev.from, prev.toExclusive));
  const meetingPeriod = new Map(groupMeetings(inRange(meetingRows, trendRange.from, trendRange.toExclusive),
    r => isoDay(periodStart(grain, toDay(r.date)))).map(g => [g.key, g]));

  const trendRows = trend.rows.map(row => {
    const li = linkedinTrend.find(r => r.key === row.period);
    const m = meetingPeriod.get(row.period);
    return {
      ...row,
      meetings: m?.meetings || 0,
      meetingsHeld: m?.held || 0,
      qualified: m?.qualified || 0,
      linkedinReplied: li?.replied || 0,
      linkedinPositive: li?.positive || 0,
    };
  });

  const repliesOf = (e, li) => (email ? e?.replied || 0 : 0) + (linkedin ? li?.replied || 0 : 0);
  const positiveOf = (e, li) => (email ? e?.positive || 0 : 0) + (linkedin ? li?.positive || 0 : 0);
  const kpi = (value, previous, series = null) => ({ value, previous, change: change(value, previous), trend: series });
  const perPeriod = fn => trendRows.map(fn);

  // Held rate counts only the meetings there is something to judge: a slot still
  // ahead, and one that moved, are not misses.
  const withRates = r => ({
    ...r,
    heldRate: rate(r.held, r.meetings - (r.upcoming || 0)),
    qualifiedRate: rate(r.qualified, r.meetings),
  });
  const ranked = rows => rows.map(withRates).sort((a, b) => b.meetings - a.meetings);

  return {
    range: describeRange(f),
    channel: view,
    companySummary: panel.summary,
    companySummaryPrevious: panelPrev.summary,
    companies: panel.companies,
    companiesCapped: panel.capped,
    tiles: {
      companies: kpi(panel.summary.total, panelPrev.summary.total),
      replies: kpi(
        repliesOf(emailRepliesNow, linkedinRepliesNow),
        repliesOf(emailRepliesPrev, linkedinRepliesPrev),
        perPeriod(r => repliesOf({ replied: r.replies }, { replied: r.linkedinReplied })),
      ),
      positive: kpi(
        positiveOf(emailRepliesNow, linkedinRepliesNow),
        positiveOf(emailRepliesPrev, linkedinRepliesPrev),
        perPeriod(r => positiveOf({ positive: r.positive }, { positive: r.linkedinPositive })),
      ),
      meetings: kpi(mtg.meetings, mtgPrev.meetings, perPeriod(r => r.meetings)),
      meetingsHeld: kpi(mtg.held, mtgPrev.held, perPeriod(r => r.meetingsHeld)),
    },
    email: emailNumbers,
    linkedin: linkedinNumbers,
    change: {
      email: email ? changesAgainst(emailNumbers, emailCard(emailPrev, emailRepliesPrev), f.elapsedShare) : null,
      linkedin: linkedin ? changesAgainst(linkedinNumbers, linkedinCard(linkedinPrev, linkedinRepliesPrev), f.elapsedShare) : null,
    },
    trend: trendRows,
    meetings: {
      totals: {
        ...withRates(mtg),
        previous: withRates(mtgPrev),
        change: Object.fromEntries(['meetings', 'held', 'qualified', 'pipelineValue'].map(k => [k, change(mtg[k], mtgPrev[k])])),
        seniorChampionRate: rate(mtg.seniorChampion, mtg.meetings),
        avgDealValue: mtg.qualified ? Math.round(mtg.pipelineValue / mtg.qualified) : null,
      },
      trend: periods.map(period => ({
        period,
        meetings: meetingPeriod.get(period)?.meetings || 0,
        held: meetingPeriod.get(period)?.held || 0,
        qualified: meetingPeriod.get(period)?.qualified || 0,
      })),
      byChannel: ranked(groupMeetings(meetingsNow, r => r.channel || 'Unknown')),
      bySdr: ranked(groupMeetings(meetingsNow, r => r.sdr || 'Unattributed')),
      byProgram: ranked(groupMeetings(meetingsNow, r => r.program || 'none')),
      capped: meetingRows.length >= MEETING_LIMIT,
    },
    bySdr: groupRows({
      emails: sdrEmail,
      emailReplies: sdrEmailReplies,
      invites: sdrLinkedin,
      linkedinReplies: sdrLinkedinReplies,
      meetings: groupMeetings(meetingsNow, r => r.sdr || 'Unattributed').map(g => ({ key: g.key, meetings: g.meetings, held: g.held })),
    }).map(r => ({ ...r, sdr: r.key })),
    byProgram: groupRows({
      emails: programEmail,
      emailReplies: programEmailReplies,
      invites: programLinkedin,
      linkedinReplies: programLinkedinReplies,
      meetings: groupMeetings(meetingsNow, r => r.program || 'none').map(g => ({ key: g.key, meetings: g.meetings, held: g.held })),
    }).map(r => ({ ...r, program: r.key })),
    replies,
  };
}
