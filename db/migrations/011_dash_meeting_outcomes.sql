-- ═══════════════════════════════════════════════════════════════════════════
-- What came of a meeting, and the evidence behind that answer
--
-- WHY: "held" was `lower(happened) = 'yes'`, and for a booking read from the
-- Slack alert `happened` was set to 'Yes' whenever ANY Fireflies or HubSpot
-- meeting event existed at that company within a day of the slot. A HubSpot
-- meeting object exists from the moment a meeting is scheduled, so that rule
-- answered "was it booked?", not "did they turn up". 21 of the 102 Slack
-- bookings marked held rested on nothing stronger than that.
--
-- It also had no way to say "moved". A booking that was rescheduled either
-- vanished (the earlier slot was deleted) or sat in the data as a meeting
-- nobody attended, which reads as a no-show.
--
-- So a meeting now carries an outcome, decided by a waterfall of evidence, and
-- the rung that decided it:
--
--   held         the audit sheet says so, or a recording puts someone from that
--                company in the room, or the sales pipeline moved afterwards
--   no_show      the audit sheet says so (a human confirmed it)
--   rescheduled  the booking moved to a later slot; neither held nor a no-show
--   upcoming     the slot has not come round yet
--   review       nothing proves they joined: either no evidence at all, or only
--                HubSpot's word for it. Counted apart from held, never as held
--
-- evidence_source names the rung, evidence_note says it in words, and both are
-- shown beside the meeting, so no number on the page is unexplained.
--
-- Written by the meetings-evidence job, which re-runs nightly: a meeting that
-- had no evidence last night becomes held the day its recording or its pipeline
-- stage arrives.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS outcome         text;
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS evidence_source text;
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS evidence_note   text;
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS evidence_at     timestamptz;

-- The booking this one moved to. The superseded slot keeps its row (it is how a
-- reschedule is visible at all) but never counts as a meeting of its own.
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS superseded_by   text;

-- The evidence job walks meetings by date, newest first.
CREATE INDEX IF NOT EXISTS dash_meetings_outcome_idx ON dash_meetings (outcome, meeting_date DESC);
