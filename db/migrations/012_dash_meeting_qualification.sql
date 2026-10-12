-- ═══════════════════════════════════════════════════════════════════════════
-- What the booking alert says about the meeting before it happens
--
-- The booking bot started screening bookings in October 2026: an alert can now
-- end with ":white_check_mark: Qualified · ICP: Yes · DevTool · …" or
-- ":red_circle: *Unqualified* · Personal email, no company to check", and the
-- team's response to it ("Qualification Email sent", "No Action") is edited
-- into the top of the same message. The alert also carries how the meeting was
-- booked and where the person says they heard of us.
--
-- None of it was being read. These columns keep it from the day it is posted,
-- so the history is there when we decide what to show.
--
-- THIS IS NOT dash_meetings.qualified. That one comes from the audit sheet and
-- means the meeting produced a qualified opportunity, which is what qualified
-- pipeline and deal value are built on. This is a screen applied at booking
-- time: is this prospect worth the slot. Today it reaches only the inbound and
-- marketing bookings that come through the web demo form — 3 of 46 alerts in
-- the three weeks to 12 Oct 2026, and none of the SDR or AE ones.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS booking_qualified  text;  -- qualified | unqualified
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS qualification_note text;  -- the bot's reasoning, verbatim
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS booking_action     text;  -- what the team did: "Qualification Email sent", "No Action"
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS booked_via         text;  -- the booking link used
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS heard_from         text;  -- "Where they heard", in the booker's words
