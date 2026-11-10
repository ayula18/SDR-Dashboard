import { qp } from '../db.js';
import { listCampaigns } from './campaigns.js';
import { cohortBreakdown, stepBreakdown } from './insights.js';
import { initials, markExtremes, notFound } from './format.js';
import { listMeetings, oneRowPerMeeting } from './meetings.js';
import { getOverview } from './overview.js';
import { positiveResponses } from './positives.js';
import { COMPANY_TYPE } from './sql.js';

/** One SDR: their overview, what works for them by theme/program/segment/step, campaigns and meetings. */
export async function getSdrDetail(name, filters) {
  const [member] = await qp(`SELECT name, color, role, aliases, email FROM dash_team WHERE lower(name) = lower($1)`, [name]);
  if (!member) throw notFound(`No team member called ${name}`);

  const f = { ...filters, sdr: member.name };
  const [overview, byTheme, byProgram, byCompanyType, steps, campaigns, meetings, positives] = await Promise.all([
    getOverview(f),
    cohortBreakdown(f, { theme: `COALESCE(l.theme, 'Other')` }),
    cohortBreakdown(f, { program: `COALESCE(l.program, 'none')` }),
    cohortBreakdown(f, { companyType: COMPANY_TYPE }, { withCompanies: true }),
    stepBreakdown(f),
    listCampaigns(f, { limit: 200 }),
    listMeetings(f, { limit: 200 }),
    positiveResponses(f, { from: f.from, toExclusive: f.toExclusive }),
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
    meetingsList: oneRowPerMeeting(meetings),
    positives,
  };
}
