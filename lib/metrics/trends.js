import { addDays, isoDay, nextPeriod, periodLabel, today } from '../outreach/dates.js';
import { allocation, emailActivity, leadOutcomes, linkedinActivity, linkedinArchive, meetingTotals } from './core.js';
import { describeRange, trailingPeriods } from './filters.js';
import { change, pointChange, rate } from './format.js';
import { linkedinOutcomes } from './linkedin.js';
import { OUTCOME_AT, bucket } from './sql.js';

export const hasCampaignFilter = f => Boolean(f.sdr || f.program || f.theme || f.campaignId);

/**
 * One row per period with every headline number, for charts and sparklines.
 * `withMeetings: false` leaves the meeting counts at zero, for a caller that
 * already has the meeting rows and would rather not query that view again.
 */
export async function getTrendSeries(filters, { grain, periods, withMeetings = true }) {
  const range = { grain, periods, from: periods[0], toExclusive: isoDay(nextPeriod(grain, periods[periods.length - 1])) };

  const [email, linkedin, outcomes, linkedinReplied, loaded, meetings, archive] = await Promise.all([
    emailActivity(filters, range, 'a.period_start::text'),
    linkedinActivity(filters, range, 'a.period_start::text'),
    leadOutcomes(filters, range, bucket(grain, OUTCOME_AT)),
    // People, each reply counted once on the day it landed, as email: HeyReach's own counter counts every reply message.
    linkedinOutcomes(filters, range, bucket(grain, OUTCOME_AT)),
    allocation(filters, range, bucket(grain, 'l.created_at_src')),
    withMeetings ? meetingTotals(filters, range, bucket(grain, 'm.meeting_date')) : [],
    hasCampaignFilter(filters) ? [] : linkedinArchive(range, { by: 'period', grain }),
  ]);

  const index = rows => new Map(rows.map(r => [r.key, r]));
  const [E, L, O, R, A, M, X] = [email, linkedin, outcomes, linkedinReplied, loaded, meetings, archive].map(index);

  const rows = periods.map(period => {
    const e = E.get(period) || {};
    const li = L.get(period) || {};
    const o = O.get(period) || {};
    const r = R.get(period) || {};
    const a = A.get(period) || {};
    const m = M.get(period) || {};
    const x = X.get(period) || {};
    const fromHeyreach = (li.invitesSent || 0) + (li.messagesSent || 0) > 0;
    const linkedinReplies = fromHeyreach ? r.replied || 0 : x.replies || 0;

    return {
      period,
      label: periodLabel(grain, period),
      sent: e.sent || 0,
      leadsContacted: e.leadsContacted || 0,
      autoReplies: e.autoReplies || 0,
      bounced: e.bounced || 0,
      opportunities: e.opportunities || 0,
      // replies, positive and negative are email's, what the rates below divide. The
      // all* numbers add LinkedIn, and are what a line simply called "Positive replies" reads.
      replies: o.replied || 0,
      positive: o.positive || 0,
      negative: o.negative || 0,
      allReplies: (o.replied || 0) + linkedinReplies,
      allPositive: (o.positive || 0) + (r.positive || 0),
      allNegative: (o.negative || 0) + (r.negative || 0),
      // Instantly's own unique human-reply count, for reconciling with `replies` (counted per lead).
      platformReplies: e.platformReplies || 0,
      leadsLoaded: a.leadsLoaded || 0,
      accountsLoaded: a.accountsLoaded || 0,
      meetings: m.meetings || 0,
      meetingsHeld: m.held || 0,
      linkedinInvitesSent: li.invitesSent || 0,
      linkedinInvitesAccepted: li.invitesAccepted || 0,
      linkedinMessagesSent: fromHeyreach ? li.messagesSent || 0 : x.messagesSent || 0,
      linkedinReplies,
      linkedinPositive: r.positive || 0,
      replyRate: rate(o.replied || 0, e.leadsContacted || 0),
      positiveRate: rate(o.positive || 0, e.leadsContacted || 0),
    };
  });

  return { grain, rows };
}

const COMPARED = ['sent', 'leadsContacted', 'replies', 'positive', 'negative', 'allReplies', 'allPositive', 'allNegative', 'leadsLoaded', 'meetings', 'meetingsHeld', 'linkedinMessagesSent', 'linkedinReplies'];

/**
 * Weekly or monthly series plus the week-on-week / month-on-month change.
 * When the latest period is still running, the comparison is between the last
 * two complete periods and the running one is returned separately.
 */
export async function getTrends(filters, { count = 12 } = {}) {
  const grain = filters.trendGrain;
  const periods = trailingPeriods(grain, filters.to, Math.min(Math.max(count, 3), 52));
  const { rows } = await getTrendSeries(filters, { grain, periods });

  const latest = rows[rows.length - 1];
  const inProgress = nextPeriod(grain, latest.period) > addDays(today(), 1);
  const [previous, current] = inProgress ? rows.slice(-3, -1) : rows.slice(-2);

  return {
    range: describeRange(filters),
    grain,
    rows,
    comparison: {
      current: current.label,
      previous: previous.label,
      basis: inProgress ? 'Last two complete periods; the current one is still running' : 'Latest two periods',
      metrics: Object.fromEntries(COMPARED.map(k => [k, { current: current[k], previous: previous[k], change: change(current[k], previous[k]) }])),
      positiveRate: { current: current.positiveRate, previous: previous.positiveRate, pointChange: pointChange(current.positiveRate, previous.positiveRate) },
    },
    inProgress: inProgress ? latest : null,
  };
}
