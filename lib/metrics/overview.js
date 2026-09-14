import { allocation, emailActivity, leadOutcomes, linkedinActivity, linkedinArchive, meetingTotals } from './core.js';
import { describeRange, trailingPeriods } from './filters.js';
import { change, pointChange, rate } from './format.js';
import { getTrendSeries, hasCampaignFilter } from './trends.js';

/**
 * Headline numbers for the selected range against the previous one, the
 * outreach funnel, and a 12-period series behind every KPI.
 */
export async function getOverview(filters) {
  const prev = filters.previous;
  const useArchive = !hasCampaignFilter(filters);

  const [email, emailPrev, li, liPrev, out, outPrev, loaded, loadedPrev, mtg, mtgPrev, archive, archivePrev, trend] = await Promise.all([
    emailActivity(filters, filters),
    emailActivity(filters, prev),
    linkedinActivity(filters, filters),
    linkedinActivity(filters, prev),
    leadOutcomes(filters, filters),
    leadOutcomes(filters, prev),
    allocation(filters, filters),
    allocation(filters, prev),
    meetingTotals(filters, filters, null, { outboundOnly: true }),
    meetingTotals(filters, prev, null, { outboundOnly: true }),
    useArchive ? linkedinArchive(filters) : null,
    useArchive ? linkedinArchive(prev) : null,
    getTrendSeries(filters, { grain: filters.trendGrain, periods: trailingPeriods(filters.trendGrain, filters.to, 12) }),
  ]);

  // Platform volumes come in whole periods; pro-rate the previous one while the current is still running.
  const prorate = v => Math.round(v * filters.elapsedShare);
  const series = key => trend.rows.map(r => r[key] ?? 0);
  const kpi = (value, previous, trendKey) => ({ value, previous, change: change(value, previous), trend: series(trendKey) });

  const positiveRate = rate(out.positive, email.leadsContacted);
  const positiveRatePrev = rate(outPrev.positive, prorate(emailPrev.leadsContacted));
  const replyRate = rate(out.replied, email.leadsContacted);
  const replyRatePrev = rate(outPrev.replied, prorate(emailPrev.leadsContacted));

  const liSource = li.invitesSent + li.messagesSent + liPrev.invitesSent + liPrev.messagesSent > 0
    ? 'heyreach'
    : useArchive ? 'archive' : 'none';
  const linkedin = liSource === 'heyreach'
    ? {
      source: 'heyreach',
      invitesSent: kpi(li.invitesSent, prorate(liPrev.invitesSent), 'linkedinInvitesSent'),
      invitesAccepted: kpi(li.invitesAccepted, prorate(liPrev.invitesAccepted), 'linkedinInvitesAccepted'),
      messagesSent: kpi(li.messagesSent, prorate(liPrev.messagesSent), 'linkedinMessagesSent'),
      replies: kpi(li.replies, prorate(liPrev.replies), 'linkedinReplies'),
      acceptanceRate: rate(li.invitesAccepted, li.invitesSent),
      replyRate: rate(li.replies, li.messagesSent),
    }
    : liSource === 'archive'
      ? {
        source: 'archive',
        note: 'HeyReach stats show no LinkedIn activity in this range, so these come from conversations the AI SDR app archived: no invites, and no split by SDR or program.',
        messagesSent: kpi(archive.messagesSent, archivePrev.messagesSent, 'linkedinMessagesSent'),
        replies: kpi(archive.replies, archivePrev.replies, 'linkedinReplies'),
        positive: { value: archive.positive, previous: archivePrev.positive, change: change(archive.positive, archivePrev.positive) },
      }
      : { source: 'none', note: 'No HeyReach campaign matching these filters sent anything in this range or the one before.' };

  return {
    range: describeRange(filters),
    kpis: {
      leadsContacted: kpi(email.leadsContacted, prorate(emailPrev.leadsContacted), 'leadsContacted'),
      emailsSent: kpi(email.sent, prorate(emailPrev.sent), 'sent'),
      replies: kpi(out.replied, outPrev.replied, 'replies'),
      positive: kpi(out.positive, outPrev.positive, 'positive'),
      positiveRate: { value: positiveRate, previous: positiveRatePrev, pointChange: pointChange(positiveRate, positiveRatePrev), trend: series('positiveRate') },
      replyRate: { value: replyRate, previous: replyRatePrev, pointChange: pointChange(replyRate, replyRatePrev), trend: series('replyRate') },
      meetings: kpi(mtg.meetings, mtgPrev.meetings, 'meetings'),
      meetingsHeld: kpi(mtg.held, mtgPrev.held, 'meetingsHeld'),
      qualified: kpi(mtg.qualified, mtgPrev.qualified, 'qualified'),
      leadsLoaded: kpi(loaded.leadsLoaded, loadedPrev.leadsLoaded, 'leadsLoaded'),
    },
    funnel: [
      { key: 'leadsContacted', label: 'Leads contacted', value: email.leadsContacted },
      { key: 'replies', label: 'Replied', value: out.replied },
      { key: 'positive', label: 'Positive', value: out.positive },
      { key: 'meetings', label: 'Meetings', value: mtg.meetings },
      { key: 'held', label: 'Held', value: mtg.held },
      { key: 'qualified', label: 'Qualified', value: mtg.qualified },
    ],
    funnelNote: 'Replies are Instantly email replies. Meetings include every outbound source (LinkedIn, calls, events), so they can exceed positive email replies.',
    email: {
      ...email,
      replyRate,
      positiveRate,
      bounceRate: rate(email.bounced, email.sent),
      negative: out.negative,
      repliedAccounts: out.repliedAccounts,
      positiveAccounts: out.positiveAccounts,
    },
    allocation: loaded,
    meetings: mtg,
    linkedin,
    trend: trend.rows,
  };
}
