-- Meetings now come from two places: the audit sheet (monthly, carries qualified
-- and deal value) and the Slack "New meeting booked" alert (daily, live). Rows
-- are tagged so each source can be refreshed without touching the other.
ALTER TABLE dash_meetings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sheet';
CREATE INDEX IF NOT EXISTS idx_dash_meetings_source ON dash_meetings(source, meeting_date);
