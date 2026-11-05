import { isoDay, today, toDay } from './dates.js';
import { normalizeDomain } from './domains.js';

/**
 * The SDR form on HubSpot deals, read as meetings (Ayush, 2026-11-05: "all sdrs fill
 * up a form in hubspot which exactly captures this info"). The form writes two deal
 * properties, date_of_meeting_sdr_form and sdr_owner. Pure, so it is tested without
 * HubSpot or a database: the job in lib/sync/jobs/meetings-sdr-form.js reads and writes.
 */

/**
 * What the form picks that is not an SDR's outreach. A blank owner is neither: it says
 * nothing. Cold calling reaches people outside any email or LinkedIn campaign, so
 * crediting a campaign that once touched the company would be a guess.
 */
const NOT_AN_SDR = /^(ads|inbound|referral|ecosystem|outbound\s*-\s*old)$|cold call/i;
/** Says outreach did it, with no person to credit. */
const NO_PERSON = /^ai sdr$/i;

/** A form date this far ahead is a typed year: Checksum.ai's "2027-07-02", on a deal from 2026-07-02. */
const FURTHEST_AHEAD_DAYS = 180;
/** A deal made this close before its meeting can be the day it was booked. */
const BOOKED_WITHIN_DAYS = 14;
/** How far a form's date can sit from a meeting and still be that meeting, as dash_v_meetings reads it. */
export const FORM_MATCH_DAYS = 14;
/**
 * A meeting this soon before the form's date, on a deal that already existed, is the one the
 * form means, typed a month off: Fingerprint's deal was made 27 Jun, the audit sheet has its
 * meeting on 30 Jun, and the form says 30 Jul. Well beyond this it is a later meeting on an old deal.
 */
const SAME_DEAL_DAYS = 45;

const daysApart = (a, b) => Math.round((toDay(a) - toDay(b)) / 86_400_000);

/** "Suman - ABM" is Suman, "Pranesh - Cold calling" is Pranesh, spelled as on the team list when they are on it. */
export function formOwner(raw, team = []) {
  const owner = String(raw ?? '').trim();
  if (!owner) return { sdr: null, notSdr: false };
  if (NOT_AN_SDR.test(owner)) return { sdr: null, notSdr: true };
  if (NO_PERSON.test(owner)) return { sdr: null, notSdr: false };
  const name = owner.split(/\s+-\s+/)[0].trim();
  const member = team.find(t => t.name.toLowerCase() === name.toLowerCase() || (t.aliases || []).includes(name.toLowerCase()));
  return { sdr: member ? member.name : name, notSdr: false };
}

export function formMeetingDate(raw, now = today()) {
  const day = String(raw ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (daysApart(day, isoDay(now)) <= FURTHEST_AHEAD_DAYS) return day;
  return `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`;
}

/** One deal as a row, or null when the form has no usable date. `canonical` folds a domain onto its company's. */
export function formRow(deal, { team = [], canonical = new Map(), now = today() } = {}) {
  const meetingDate = formMeetingDate(deal.properties?.date_of_meeting_sdr_form, now);
  if (!meetingDate) return null;
  const { sdr, notSdr } = formOwner(deal.properties?.sdr_owner, team);
  const company = (deal.companies || []).find(c => normalizeDomain(c.domain || c.website)) || deal.companies?.[0] || null;
  const domain = company ? normalizeDomain(company.domain || company.website) : null;
  const created = String(deal.properties?.createdate ?? '').slice(0, 10) || null;
  const lead = created ? daysApart(meetingDate, created) : null;
  return {
    dealId: String(deal.id),
    companyDomain: domain ? canonical.get(domain) || domain : null,
    companyName: company?.name || null,
    meetingDate,
    ownerRaw: deal.properties?.sdr_owner || null,
    sdr,
    notSdr,
    sourceOfMeeting: deal.properties?.source_of_meeting || null,
    createdOn: created,
    bookedOn: lead !== null && lead >= 0 && lead <= BOOKED_WITHIN_DAYS ? created : null,
  };
}

/**
 * Form rows naming an SDR that no meeting we hold can be: those are meetings of their
 * own. Two deals at a company for one meeting are one meeting, so a row also stands
 * against the ones already kept. `meetings`: { domain, date }, from every other source.
 */
export function meetingsOnlyOnForm(rows, meetings) {
  const kept = [];
  const nearAny = (row, others) => others.some(o => o.domain === row.companyDomain && Math.abs(daysApart(o.date, row.meetingDate)) <= FORM_MATCH_DAYS);
  const earlierOnThisDeal = row => Boolean(row.createdOn) && meetings.some(o => o.domain === row.companyDomain
    && o.date >= row.createdOn && o.date <= row.meetingDate && daysApart(row.meetingDate, o.date) <= SAME_DEAL_DAYS);
  for (const row of [...rows].sort((a, b) => a.meetingDate.localeCompare(b.meetingDate))) {
    if (!row.sdr || !row.companyDomain) continue;
    if (nearAny(row, meetings) || earlierOnThisDeal(row)) continue;
    if (nearAny(row, kept.map(k => ({ domain: k.companyDomain, date: k.meetingDate })))) continue;
    kept.push(row);
  }
  return kept;
}

