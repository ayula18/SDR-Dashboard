import crypto from 'crypto';
import { qp, upsertRows } from '../db.js';
import { isoDay, monthStart, weekStart } from '../outreach/dates.js';
import { MEETING_COLUMNS } from './meetings.js';

/**
 * The third rung of the booking waterfall: meetings HubSpot knows about and the
 * other two sources missed.
 *
 *   1 the audit sheet   complete where it reaches, and the only source of
 *                       qualified and deal value
 *   2 the Slack alert   every booking from the day it is made
 *   3 HubSpot           what is left, so a silent Slack channel does not read
 *                       as a quarter with no meetings
 *
 * HubSpot holds every meeting the company has — onboarding, customer calls,
 * investor catch-ups — so this takes only what looks like a first meeting with
 * a prospect we had already contacted:
 *
 *   - the company resolved to a domain, and we emailed or messaged someone
 *     there before the meeting was booked
 *   - no earlier HubSpot meeting at that company, so onboarding and recurring
 *     calls with people we already work with stay out
 *   - nothing already in dash_meetings for that company within three days, so
 *     it never duplicates a booking the sheet or the alert already carries
 *
 * These rows carry no SDR, channel, qualified or deal value: HubSpot's meeting
 * objects have no owner on them here. The campaign attribution in
 * dash_v_meetings fills in the SDR and program, and `source_of_meeting` says
 * HubSpot so the row can be told apart on the page.
 */

const LOOKBACK_DAYS = 180;

export async function syncHubspotMeetings({ days = LOOKBACK_DAYS } = {}) {
  const from = isoDay(new Date(Date.now() - days * 86_400_000));

  const rows = await qp(
    `WITH slots AS (
       SELECT e.domain,
              (e.occurred_at AT TIME ZONE 'UTC')::date::text AS day,
              min(e.occurred_at) AS at,
              (array_agg(e.raw->'properties'->>'hs_meeting_title' ORDER BY e.occurred_at))[1] AS title
         FROM ctx_events e
        WHERE e.source = 'hubspot' AND e.event_type = 'meeting' AND e.domain IS NOT NULL
          AND e.occurred_at >= $1::date
        GROUP BY 1, 2
     ),
     first_meeting AS (
       SELECT domain, min(occurred_at)::date AS first_day
         FROM ctx_events
        WHERE source = 'hubspot' AND event_type = 'meeting' AND domain IS NOT NULL
        GROUP BY 1
     )
     SELECT s.domain, s.day, s.title
       FROM slots s
       JOIN first_meeting f ON f.domain = s.domain AND f.first_day = s.day::date
      WHERE (
              EXISTS (SELECT 1 FROM dash_v_leads l
                       WHERE l.company_domain = s.domain AND NOT l.excluded AND l.contacted
                         AND l.created_at_src <= s.at)
           OR EXISTS (SELECT 1 FROM dash_v_linkedin_leads li
                       WHERE li.company_domain = s.domain AND NOT li.excluded AND li.reached
                         AND li.added_at <= s.at)
            )
        AND NOT EXISTS (
              SELECT 1 FROM dash_meetings m
               WHERE m.source <> 'hubspot' AND m.company_domain = s.domain
                 AND m.meeting_date BETWEEN s.day::date - 3 AND s.day::date + 3
            )
      ORDER BY s.day DESC`,
    [from]
  );

  const importedAt = new Date();
  const meetings = rows.map(r => {
    const date = new Date(`${r.day}T00:00:00Z`);
    const id = `hubspot:${crypto.createHash('md5').update(`${r.domain}|${r.day}`).digest('hex')}`;
    return [
      id, r.domain, r.domain, r.day, isoDay(weekStart(date)), isoDay(monthStart(date)),
      // source_of_meeting, channel and direction stay empty: HubSpot's meeting objects
      // carry no owner here, so who booked it, through which channel, and whether it was
      // outbound at all is not ours to claim. dash_v_meetings reads that silence as
      // booking_by = 'unknown', which can be influenced by outreach but never sourced.
      // The `source` column already says the row came from HubSpot.
      null, null, null,
      null, null, null, null,   // sdr_name, qualified, points, deal_value: the sheet decides those
      null,                     // happened: meetings-evidence decides
      null, null, null, null, null, r.title || null,
      'hubspot', importedAt, 'hubspot',
    ];
  });

  // A booking the sheet or an alert has since picked up is no longer ours to carry.
  const keep = meetings.map(m => m[0]);
  const removed = await qp(
    keep.length
      ? `DELETE FROM dash_meetings WHERE source = 'hubspot' AND meeting_date >= $1 AND id <> ALL($2::text[]) RETURNING id`
      : `DELETE FROM dash_meetings WHERE source = 'hubspot' AND meeting_date >= $1 RETURNING id`,
    keep.length ? [from, keep] : [from]
  );

  const written = meetings.length ? await upsertRows('dash_meetings', MEETING_COLUMNS, meetings, { conflict: ['id'] }) : 0;
  return { meetings: written, dropped: removed.length, since: from };
}
