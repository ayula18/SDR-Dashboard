-- ═══════════════════════════════════════════════════════════════════════════
-- Answers given on Meeting checks, which outrank every source.
--
-- WHY (Ayush, 2026-11-10): meetings with no channel, an unsure source, or a booking
-- nobody names need "a new section in the nav bar where we can manually select the
-- details and fill up such cases". An answer there is the SDR's own word, the first
-- rung of the meeting credit (lib/outreach/meeting-credit.js), like stated_sdr (020)
-- and campaign_id (016), and no sync writes these columns either.
--   stated_channel  email | linkedin | call, when it came without a campaign to say so
--   stated_not_sdr  someone said it is not an SDR meeting
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* objects. IDEMPOTENT — safe to run multiple times.    │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS stated_channel TEXT CHECK (stated_channel IN ('email', 'linkedin', 'call'));
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS stated_not_sdr BOOLEAN NOT NULL DEFAULT FALSE;
