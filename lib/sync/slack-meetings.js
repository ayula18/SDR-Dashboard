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
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const plain = value => (value == null ? null : unlink(String(value).replace(/&(amp|lt|gt|quot|#39);/g, m => ENTITIES[m])
  .replace(/[`*]/g, '').replace(/\s+/g, ' ').trim()) || null);
const field = (body, label) => {
  const match = body.match(new RegExp(`\\*${label}:\\*\\s*([^\\n*]+)`));
  return match ? unlink(match[1]) : null;
};

/**
 * The screen the bot applies to a booking before anyone takes it: a verdict
 * line at the foot of the alert, and the team's answer edited into the top.
 *
 *   :white_check_mark: Qualified  ·  ICP: Yes  ·  DevTool  ·  CI/CD & Build Systems
 *   :red_circle: *Unqualified*  ·  Personal email, no company to check.
 *   :white_check_mark: *Qualification Email* sent  ·  by <@U05SZ5JLM36>  ·  8 Oct, 5:35 PM IST
 *
 * This is not the audit sheet's `qualified`, which says whether the meeting
 * produced a qualified opportunity. This one is about the booking.
 */
export function parseQualification(body) {
  const text = String(body || '');
  const unqualified = text.match(/(?::red_circle:|:x:)?\s*\*?Unqualified\*?\s*(?:[·•|-]\s*)?([^\n]*)/i);
  const qualified = text.match(/:white_check_mark:\s*\*?Qualified\*?\s*(?:[·•|-]\s*)?([^\n]*)/i);
  // "Qualification Email sent" also opens with :white_check_mark:, so the verdict
  // is only a verdict when the word stands on its own.
  const verdict = unqualified ? 'unqualified' : qualified && !/Qualification Email/i.test(qualified[0]) ? 'qualified' : null;
  const note = verdict === 'unqualified' ? plain(unqualified[1]) : verdict === 'qualified' ? plain(qualified[1]) : null;

  // The first line carries what the team did about it, when they have done anything.
  const [first = ''] = text.split('\n');
  const action = /New meeting booked/i.test(first) ? null
    : plain(first.replace(/·\s*by\s*<@[^>]+>.*$/i, '').replace(/^[-–—\s]*/, '').replace(/^:[a-z0-9_+-]+:\s*/i, ''));

  return { qualified: verdict, qualificationNote: note, action: action || null };
}

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

  const { qualified, qualificationNote, action } = parseQualification(body);

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
    bookedVia: plain(field(body, 'Booked via')),
    heardFrom: plain(field(body, 'Where they heard')),
    qualified,
    qualificationNote,
    action,
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

  // Whether anyone turned up is not this job's question: the meetings-evidence
  // job answers it from recordings and the pipeline, and records what it went on.
  // This job used to mark a booking held whenever ANY Fireflies or HubSpot meeting
  // existed at that company that day, and a HubSpot meeting object exists from the
  // moment a meeting is scheduled, so it was really marking "was booked" as "was held".

  // A rescheduled booking posts a second alert. Both slots are kept, the earlier
  // one pointing at the later: a moved meeting is neither held nor a no-show, and
  // deleting it left no trace that it had ever moved.
  const byPerson = new Map();
  for (const meeting of seen) {
    const key = `${meeting.domain || 'no-company'}|${(meeting.email || meeting.person || meeting.id).toLowerCase()}`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(meeting);
  }
  const keep = [];
  for (const bookings of byPerson.values()) {
    const ordered = [...bookings].sort((a, b) => a.date - b.date || new Date(a.bookedAt) - new Date(b.bookedAt));
    const latest = ordered[ordered.length - 1];
    for (const booking of ordered) {
      booking.supersededBy = booking === latest ? null : latest.id;
      keep.push(booking);
    }
  }

  const importedAt = new Date();
  const rows = keep.map(m => [
    m.id, m.domain, m.companyRaw, isoDay(m.date), isoDay(weekStart(m.date)), isoDay(monthStart(m.date)),
    m.sourceOfMeeting, m.channel, m.direction,
    null, null, null, null,          // sdr_name, qualified, points, deal_value: the sheet and campaigns decide
    null,                            // happened: the audit sheet's column, which a Slack booking has no view of
    null, null, null, null, null, m.basis,
    `slack:${m.slackChannel || 'channel'}`, importedAt, 'slack',
  ]);

  const written = await withTx(async client => {
    const count = rows.length ? await upsertRows('dash_meetings', MEETING_COLUMNS, rows, { conflict: ['id'], client }) : 0;
    // Everything the alert carries beyond the booking itself: the bot's screen of
    // it, what the team did about it, and how it was booked. Written here rather
    // than through MEETING_COLUMNS because no other source has any of it.
    // superseded_by is cleared first: a booking that moved yesterday may be the
    // latest one today.
    if (keep.length) {
      await client.query(
        `UPDATE dash_meetings m
            SET superseded_by      = u.superseded_by,
                booking_qualified  = u.qualified,
                qualification_note = u.note,
                booking_action     = u.action,
                booked_via         = u.booked_via,
                heard_from         = u.heard_from
           FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS superseded_by,
                        unnest($3::text[]) AS qualified, unnest($4::text[]) AS note,
                        unnest($5::text[]) AS action, unnest($6::text[]) AS booked_via,
                        unnest($7::text[]) AS heard_from) u
          WHERE m.id = u.id`,
        [
          keep.map(m => m.id), keep.map(m => m.supersededBy), keep.map(m => m.qualified),
          keep.map(m => m.qualificationNote), keep.map(m => m.action),
          keep.map(m => m.bookedVia), keep.map(m => m.heardFrom),
        ]
      );
    }
    return count;
  });

  return {
    alerts: alerts.length,
    meetings: written,
    unreadable,
    rescheduled: keep.filter(m => m.supersededBy).length,
    screened: keep.filter(m => m.qualified).length,
    withoutCompany: rows.filter(r => !r[1]).length,
    since: isoDay(since),
  };
}
