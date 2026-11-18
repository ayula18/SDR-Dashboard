-- When a meeting was BOOKED, which is the day "Meetings booked" counts it on (Ayush,
-- 2026-11-17: Ahmed booked eG Innovations on 16 Nov for 17 Nov and Rama booked Virtuozzo on
-- 13 Nov for 16 Nov, while every page dated meetings by the day they happen).
--
-- booked_at is the moment of booking where a source records one:
--   slack    the booking alert's post time (the bot posts as the meeting is booked),
--            written by meetings-slack from the archived alert
--   hubspot  hs_createdate of the HubSpot meeting object, written by meetings-hubspot
-- The sheet, the form and manual rows have no time of booking; dash_v_meetings (900) gives
-- every meeting its booked_on from the earliest booked_at of its records, else the form's
-- booking day, else the meeting day.
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ;

-- Rows already written. Counted read-only on 2026-11-17 before this was written: 298 Slack
-- rows, every one with its alert in the archive (none posted after its meeting), and 76
-- HubSpot rows. Only empty booked_at is filled, so a re-run changes nothing.
UPDATE dash_meetings dm
   SET booked_at = e.occurred_at
  FROM ctx_events e
 WHERE dm.source = 'slack' AND dm.booked_at IS NULL
   AND e.source = 'slack' AND e.source_event_id = substr(dm.id, 7);

UPDATE dash_meetings dm
   SET booked_at = h.created
  FROM (
    SELECT e.domain, (e.occurred_at AT TIME ZONE 'UTC')::date AS day,
           min(CASE WHEN e.raw->'properties'->>'hs_createdate' ~ '^\d{4}-\d{2}-\d{2}T'
                    THEN (e.raw->'properties'->>'hs_createdate')::timestamptz END) AS created
      FROM ctx_events e
     WHERE e.source = 'hubspot' AND e.event_type = 'meeting' AND e.domain IS NOT NULL
     GROUP BY 1, 2
  ) h
 WHERE dm.source = 'hubspot' AND dm.booked_at IS NULL AND h.created IS NOT NULL
   AND h.domain = dm.company_domain AND h.day = dm.meeting_date;
