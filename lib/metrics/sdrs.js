import { qp } from '../db.js';
import { allocation, emailActivity, leadOutcomes, meetingTotals } from './core.js';
import { listCampaigns } from './campaigns.js';
import { cohortBreakdown, stepBreakdown } from './insights.js';
import { describeRange } from './filters.js';
import { MIN_SAMPLE, change, initials, markExtremes, notFound, pointChange, rate } from './format.js';
import { listMeetings } from './meetings.js';
import { getOverview } from './overview.js';
import { COMPANY_TYPE } from './sql.js';

const UNATTRIBUTED = 'Unattributed';

/** Every SDR side by side for the range, with the previous range for context. Rates, not raw volume, decide rank. */
export async function getLeaderboard(filters) {
  const f = { ...filters, sdr: null };
  const prev = f.previous;
  const [team, email, emailPrev, out, outPrev, loaded, mtg, mtgPrev] = await Promise.all([
    qp(`SELECT name, color FROM dash_team WHERE is_active AND role = 'sdr' ORDER BY name`),
    emailActivity(f, f, 'c.sdr'),
    emailActivity(f, prev, 'c.sdr'),
    leadOutcomes(f, f, 'l.sdr'),
    leadOutcomes(f, prev, 'l.sdr'),
    allocation(f, f, 'l.sdr'),
    meetingTotals(f, f, 'm.attributed_sdr', { outboundOnly: true }),
    meetingTotals(f, prev, 'm.attributed_sdr', { outboundOnly: true }),
  ]);

  const find = (rows, name) => rows.find(r => r.key === name) || {};
  const prorate = v => Math.round((v || 0) * f.elapsedShare);

  const row = (name, color) => {
    const e = find(email, name), ep = find(emailPrev, name);
    const o = find(out, name), op = find(outPrev, name);
    const a = find(loaded, name);
    const m = find(mtg, name), mp = find(mtgPrev, name);
    const leadsContacted = e.leadsContacted || 0;
    const positiveRate = rate(o.positive || 0, leadsContacted);
    const positiveRatePrev = rate(op.positive || 0, prorate(ep.leadsContacted));
    return {
      name: name ?? UNATTRIBUTED,
      initials: initials(name ?? '?'),
      color: color || '#94a3b8',
      activeCampaigns: e.activeCampaigns || 0,
      accountsLoaded: a.accountsLoaded || 0,
      leadsLoaded: a.leadsLoaded || 0,
      sent: e.sent || 0,
      leadsContacted,
      replies: o.replied || 0,
      positive: o.positive || 0,
      negative: o.negative || 0,
      positiveAccounts: o.positiveAccounts || 0,
      bounced: e.bounced || 0,
      meetings: m.meetings || 0,
      meetingsHeld: m.held || 0,
      qualified: m.qualified || 0,
      pipelineValue: m.pipelineValue || 0,
      replyRate: rate(o.replied || 0, leadsContacted),
      positiveRate,
      bounceRate: rate(e.bounced || 0, e.sent || 0),
      meetingRate: rate(m.meetings || 0, o.positive || 0),
      lowSample: leadsContacted < MIN_SAMPLE,
      previous: {
        leadsContacted: prorate(ep.leadsContacted),
        replies: op.replied || 0,
        positive: op.positive || 0,
        meetings: mp.meetings || 0,
        positiveRate: positiveRatePrev,
      },
      change: {
        leadsContacted: change(leadsContacted, prorate(ep.leadsContacted)),
        replies: change(o.replied || 0, op.replied || 0),
        positive: change(o.positive || 0, op.positive || 0),
        meetings: change(m.meetings || 0, mp.meetings || 0),
        positiveRate: pointChange(positiveRate, positiveRatePrev),
      },
    };
  };

  const sdrs = team.map(t => row(t.name, t.color));
  const unattributed = row(null, null);

  return {
    range: describeRange(f),
    sdrs: markExtremes(sdrs).sort((a, b) => (b.positive - a.positive) || (b.meetings - a.meetings) || (b.leadsContacted - a.leadsContacted)),
    unattributed: unattributed.sent + unattributed.replies + unattributed.meetings > 0 ? unattributed : null,
  };
}

/** One SDR: their overview, what works for them by theme/program/segment/step, campaigns and meetings. */
export async function getSdrDetail(name, filters) {
  const [member] = await qp(`SELECT name, color, role, aliases, email FROM dash_team WHERE lower(name) = lower($1)`, [name]);
  if (!member) throw notFound(`No team member called ${name}`);

  const f = { ...filters, sdr: member.name };
  const [overview, byTheme, byProgram, byCompanyType, steps, campaigns, meetings] = await Promise.all([
    getOverview(f),
    cohortBreakdown(f, { theme: `COALESCE(l.theme, 'Other')` }),
    cohortBreakdown(f, { program: `COALESCE(l.program, 'none')` }),
    cohortBreakdown(f, { companyType: COMPANY_TYPE }, { withCompanies: true }),
    stepBreakdown(f),
    listCampaigns(f, { limit: 200 }),
    listMeetings(f, { limit: 200 }),
  ]);

  return {
    sdr: { ...member, initials: initials(member.name) },
    ...overview,
    whatWorks: {
      basis: 'Leads this SDR loaded in the range; positive replies per contacted lead.',
      byTheme: markExtremes(byTheme),
      byProgram: markExtremes(byProgram),
      byCompanyType: markExtremes(byCompanyType),
      steps,
    },
    campaigns,
    meetingsList: meetings,
  };
}
