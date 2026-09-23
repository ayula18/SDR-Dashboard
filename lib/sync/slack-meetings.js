import { qp, upsertRows, withTx } from '../db.js';
import { addDays, isoDay, monthStart, weekStart } from '../outreach/dates.js';
import { domainFromEmail, normalizeDomain } from '../outreach/domains.js';
import { MEETING_COLUMNS } from './meetings.js';

/**
 * Meetings as they are booked, from the Slack alert the booking bot posts:
 *
 *   :calendar: *New meeting booked*
 *   *Owner:* SDR  (SDR Team)     *Basis:* link
 *   *Name:* Paul Dudley          *Email:* paul@streamkap.com
 *   *Company:* streamkap.com     *When:* 16 Sep 2026, 08:00 PM IST
 *
 * The AI SDR app already archives that channel daily, so this reads ctx_events
 * and writes dash_meetings: no API call, one bounded query per run. The audit
 * sheet stays the source of qualified and deal value; these rows carry what the
 * sheet cannot, which is every booking from the day it happens.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Personal-email bookings resolve onto a catch-all in the archive; they are not companies.
const NOT_A_COMPANY = new Set(['calendar.help', 'unknown', 'none', 'n/a']);
const TEAM_CHANNEL = {
  'sdr team': 'SDR', sdr: 'SDR', 'ae team': 'AE', inbound: 'Inbound',
  marketing: 'Marketing', referral: 'Referral', partnerships: 'Partners', 'self-serve': 'Self-serve',
};
const OUTBOUND = new Set(['SDR', 'AE', 'Partners']);

// Slack writes links as <http://jfrog.com|jfrog.com> and addresses as <mailto:a@b.com|a@b.com>.
const unlink = value => (value == null ? null : String(value).replace(/<(?:mailto:|https?:\/\/)?([^|>]+)(?:\|[^>]*)?>/g, '$1').trim() || null);
const field = (body, label) => {
  const match = body.match(new RegExp(`\\*${label}:\\*\\s*([^\\n*]+)`));
  return match ? unlink(match[1]) : null;
};

/** One alert → a meeting, or null when it is not the bot's alert or carries no date. */
export function parseAlert(body) {
  if (!body || !body.includes('New meeting booked') || !body.includes('*Owner:*')) return null;

  const when = field(body, 'When');
  const stamp = when && when.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  const month = stamp ? MONTHS.indexOf(stamp[2].toLowerCase()) : -1;
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(stamp[3]), month, Number(stamp[1])));

  // "SDR  (SDR Team)" is the booking link's owner and the team behind it.
  const owner = (field(body, 'Owner') || '').replace(/\s{2,}/g, ' ');
  const [, label, team] = owner.match(/^(.*?)\s*\(([^)]+)\)\s*$/) || [null, owner, ''];
  const channel = TEAM_CHANNEL[team.trim().toLowerCase()] || team.trim() || null;

  const email = field(body, 'Email');
  const companyText = field(body, 'Company');
  const fromLine = companyText && !NOT_A_COMPANY.has(companyText.toLowerCase()) ? normalizeDomain(companyText) : null;
  const domain = fromLine || domainFromEmail(email);

  return {
    date,
    domain: domain && !NOT_A_COMPANY.has(domain) ? domain : null,
    companyRaw: companyText || email || null,
    person: field(body, 'Name'),
    email,
    sourceOfMeeting: (label || '').trim() || null,
    channel,
    direction: channel ? (OUTBOUND.has(channel) ? 'Outbound' : 'Inbound') : null,
    basis: field(body, 'Basis'),
  };
}

/**
 * Reads the alerts of the last `days` and rewrites the meetings they describe.
 * Re-reading a window costs one query and repairs anything that changed, the
 * way the outreach syncs re-read a recent overlap.
 */
export async function syncSlackMeetings({ days = 45 } = {}) {
  const since = addDays(new Date(), -days);

  const alerts = await qp(
    `SELECT source_event_id, occurred_at, body, raw->>'channel' AS channel
       FROM ctx_events
      WHERE source = 'slack' AND event_type = 'meeting_booked'
        AND occurred_at >= $1 AND body LIKE '%New meeting booked%'
      ORDER BY occurred_at`,
    [isoDay(since)]
  );

  const seen = [];
  let unreadable = 0;
  for (const alert of alerts) {
    const parsed = parseAlert(alert.body);
    if (!parsed) { unreadable += 1; continue; }
    seen.push({ ...parsed, id: `slack:${alert.source_event_id}`, bookedAt: alert.occurred_at, slackChannel: alert.channel });
  }

  // Did it happen? A Fireflies or HubSpot meeting at that company within a day of the slot.
  const domains = [...new Set(seen.map(m => m.domain).filter(Boolean))];
  const evidence = new Set();
  if (domains.length) {
    const rows = await qp(
      `SELECT DISTINCT COALESCE(e.domain, c.domain) AS domain, (e.occurred_at AT TIME ZONE 'UTC')::date::text AS day
         FROM ctx_events e
         LEFT JOIN companies c ON c.id = e.company_id
        WHERE e.event_type = 'meeting' AND e.source IN ('fireflies', 'hubspot')
          AND e.occurred_at >= $1 AND COALESCE(e.domain, c.domain) = ANY($2::text[])`,
      [isoDay(addDays(since, -2)), domains]
    );
    for (const row of rows) evidence.add(`${row.domain}|${row.day}`);
  }
  const held = m => (m.domain && [-1, 0, 1].some(offset => evidence.has(`${m.domain}|${isoDay(addDays(m.date, offset))}`)) ? 'Yes' : null);

  // A rescheduled booking posts a second alert; the slot it moved from never happened.
  const byPerson = new Map();
  for (const meeting of seen) {
    meeting.happened = held(meeting);
    const key = `${meeting.domain || 'no-company'}|${(meeting.email || meeting.person || meeting.id).toLowerCase()}`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(meeting);
  }
  const keep = [];
  for (const bookings of byPerson.values()) {
    const happened = bookings.filter(m => m.happened === 'Yes');
    const latest = bookings[bookings.length - 1];
    keep.push(...happened);
    if (!happened.includes(latest)) keep.push(latest);
  }

  const importedAt = new Date();
  const rows = keep.map(m => [
    m.id, m.domain, m.companyRaw, isoDay(m.date), isoDay(weekStart(m.date)), isoDay(monthStart(m.date)),
    m.sourceOfMeeting, m.channel, m.direction,
    null, null, null, null,          // sdr_name, qualified, points, deal_value: the sheet and campaigns decide
    m.happened,
    null, null, null, null, null, m.basis,
    `slack:${m.slackChannel || 'channel'}`, importedAt, 'slack',
  ]);

  const keepIds = new Set(keep.map(m => m.id));
  const superseded = seen.filter(m => !keepIds.has(m.id)).map(m => m.id);

  const written = await withTx(async client => {
    if (superseded.length) {
      await client.query(`DELETE FROM dash_meetings WHERE source = 'slack' AND id = ANY($1::text[])`, [superseded]);
    }
    return rows.length ? upsertRows('dash_meetings', MEETING_COLUMNS, rows, { conflict: ['id'], client }) : 0;
  });

  return {
    alerts: alerts.length,
    meetings: written,
    unreadable,
    superseded: superseded.length,
    held: rows.filter(r => r[13] === 'Yes').length,
    withoutCompany: rows.filter(r => !r[1]).length,
    since: isoDay(since),
  };
}
