import { qp } from '../db.js';
import { toDay } from '../outreach/dates.js';
import { badRequest, displayCompany } from './format.js';
import { listMeetings, oneRowPerMeeting } from './meetings.js';
import { positiveResponses } from './positives.js';

/**
 * The names behind a Positive or Meetings number (Ayush, 2026-11-07): the same rows the
 * number counts, so a list can never hold more or fewer than the number that opened it.
 * Positives come from positiveResponses and meetings from listMeetings, as every card does.
 *
 * `channel` is email, linkedin, or none for meetings with no campaign behind them; left
 * out, it is both channels and every meeting.
 */
const PLATFORM = { email: 'instantly', linkedin: 'heyreach' };
// A meetings list narrows by the meeting credit's channel: 'none' is one nothing placed yet.
const MEETING_CHANNEL = { email: 'instantly', linkedin: 'heyreach', call: 'call', none: 'unknown' };
const DAY_MS = 86_400_000;
// How long before a meeting a reply can still be what led to it, as bookedPositives allows.
const LED_TO_MEETING_DAYS = 60;

/**
 * Who a meeting was with, as far as we can tell. A meeting row names a company, not a
 * person, so this is the person whose reply led to it: an interested reply first, then a
 * name logged on the sheet, then any reply, the latest of each. Display only: nothing
 * counts through it.
 */
export function whoBooked(meeting, candidates) {
  if (!meeting.domain) return null;
  const day = toDay(meeting.date).getTime();
  const rank = c => (c.positive ? 2 : c.logged ? 1 : 0);
  return candidates
    .filter(c => c.domain === meeting.domain)
    .filter(c => {
      const at = new Date(c.at).getTime();
      return at >= day - LED_TO_MEETING_DAYS * DAY_MS && at < day + DAY_MS;
    })
    .sort((a, b) => rank(b) - rank(a) || new Date(b.at) - new Date(a.at))[0] || null;
}

async function peopleAtCompanies(domains) {
  if (!domains.length) return [];
  const [replies, logged] = await Promise.all([
    qp(`
      SELECT COALESCE(cd.canonical_domain, v.company_domain) AS domain, COALESCE(v.person_name, v.person_email) AS name,
             v.quote, v.is_positive AS positive, v.replied_at AS at
        FROM dash_v_reply_verdicts v
        LEFT JOIN dash_company_domains cd ON cd.domain = v.company_domain
       WHERE NOT v.is_auto AND COALESCE(cd.canonical_domain, v.company_domain) = ANY($1::text[])`, [domains]),
    qp(`
      SELECT s.company_domain AS domain, s.person_name AS name, s.replied_at AS at, TRUE AS logged
        FROM dash_v_sheet_positives s
       WHERE s.company_domain = ANY($1::text[]) AND s.person_name IS NOT NULL`, [domains]),
  ]);
  return [...replies, ...logged];
}

export async function getOutcomes(filters, { kind, channel = null } = {}) {
  const range = { from: filters.from, toExclusive: filters.toExclusive };
  if (kind === 'positive') {
    if (channel && !PLATFORM[channel] && channel !== 'call') throw badRequest('Positive responses are email, linkedin or call');
    return { kind, rows: await positiveResponses(filters, { ...range, channel: channel || 'both' }) };
  }
  if (kind !== 'meetings') throw badRequest('"kind" wants positive or meetings');

  // One row per meeting: a split meeting's two SDR rows are one meeting in a list.
  if (channel && !MEETING_CHANNEL[channel]) throw badRequest('Meetings are email, linkedin, call or none');
  const meetings = oneRowPerMeeting(await listMeetings(filters, { ...range, platform: MEETING_CHANNEL[channel] || null, withRescheduled: false, limit: 3000 }));
  const domains = [...new Set(meetings.map(m => m.domain).filter(Boolean))];
  const [candidates, registry] = await Promise.all([
    peopleAtCompanies(domains),
    qp(`SELECT domain, company_name FROM companies WHERE domain = ANY($1::text[])`, [domains]),
  ]);
  const registered = new Map(registry.map(c => [c.domain, c.company_name]));
  return {
    kind,
    rows: meetings.map(m => {
      const person = whoBooked(m, candidates);
      return {
        id: m.id,
        at: m.date,
        company: displayCompany(registered.get(m.domain), m.company, m.domain) || m.domain,
        domain: m.domain,
        companyKey: m.domain,
        sdr: m.sdr,
        share: m.share,
        campaign: m.campaign,
        channel: m.outreachChannel,
        reason: m.reason,
        outcome: m.outcome,
        name: person?.name || null,
        quote: person?.quote || null,
      };
    }),
  };
}
