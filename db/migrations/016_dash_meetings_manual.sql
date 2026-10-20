-- ═══════════════════════════════════════════════════════════════════════════
-- Meetings an SDR states directly, and attribution only they know.
--
-- Two gaps, measured on the last 90 days:
--
--   1. 28 outbound SDR/AE meetings carry no campaign. The attribution lateral
--      in dash_v_meetings looks for outreach to that company in the 180 days
--      before; when there is none recorded, there is nothing to find. The
--      booking is real, the credit is lost.
--   2. The Slack alert carries no SDR for those rows either, so they belong to
--      nobody on the SDR page.
--
-- HubSpot cannot close this: its meeting objects here carry only title, body,
-- outcome and timestamps — no owner. So the person who booked it has to be able
-- to say so.
--
--   campaign_id  an attribution an SDR asserts. dash_v_meetings prefers it over
--                the lateral, so it fixes a booking from ANY source, not just a
--                manual one.
--   created_by   who said so.
--   entry_note   why, in their words.
--
-- A manual row uses source = 'manual', which no sync job deletes: meetings-csv
-- replaces only 'sheet', meetings-slack only 'slack', meetings-hubspot only
-- 'hubspot'. Nothing a human types is ever overwritten by a sync.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS created_by  text;
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS entry_note  text;

CREATE INDEX IF NOT EXISTS dash_meetings_campaign_idx
  ON dash_meetings (campaign_id) WHERE campaign_id IS NOT NULL;
