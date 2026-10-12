-- ═══════════════════════════════════════════════════════════════════════════
-- Fair scheduling: per-campaign read watermarks
--
-- WHY: the two HeyReach jobs could not make progress even when given time.
--
--   heyreach       had no cursor at all. It walked `targets` from index 0 every
--                  run, so a budget that covered 70 of 241 campaigns re-read the
--                  same 70 every night and never reached the rest.
--   heyreach-leads had a cursor that could not advance: it unconditionally
--                  included every IN_PROGRESS campaign and sorted those first,
--                  so the same handful consumed each run and the backlog behind
--                  them was never touched.
--
-- An index cursor cannot fix this safely — `targets` comes back in whatever
-- order the API returns, so an index into a re-sorted or shrunk list silently
-- SKIPS campaigns, which is worse than re-reading them. A per-campaign
-- watermark cannot skip or desync: ordering by it puts never-read campaigns
-- first and just-read ones last, so rotation is a property of the data rather
-- than a policy the job has to remember.
--
-- These also cut API usage: a campaign already read is no longer re-read on the
-- next run just because it sorts early.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ ADDITIVE. Only adds columns to a dash_* table this app owns.            │
-- └─────────────────────────────────────────────────────────────────────────┘
-- IDEMPOTENT — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

-- When this campaign's overall stats were last read (the `heyreach` job).
ALTER TABLE dash_campaigns ADD COLUMN IF NOT EXISTS stats_read_at TIMESTAMPTZ;

-- When this campaign's people were last read, and the status they were read at.
-- The status is kept so a campaign that changes state is re-read even if it was
-- read recently; a running campaign is also refreshed on a timer.
ALTER TABLE dash_campaigns ADD COLUMN IF NOT EXISTS leads_read_at TIMESTAMPTZ;
ALTER TABLE dash_campaigns ADD COLUMN IF NOT EXISTS leads_read_status TEXT;

-- Both jobs order by "least recently read first", so index that directly.
CREATE INDEX IF NOT EXISTS idx_dash_campaigns_stats_read
  ON dash_campaigns (stats_read_at NULLS FIRST) WHERE platform = 'heyreach';
CREATE INDEX IF NOT EXISTS idx_dash_campaigns_leads_read
  ON dash_campaigns (leads_read_at NULLS FIRST) WHERE platform = 'heyreach';

-- The old heyreach-leads cursor encoded {statuses:{...}} and is now meaningless;
-- leaving it would make the job think campaigns were read when the watermark
-- says otherwise. Dropping the row makes it start from the watermark cleanly.
-- (Precedent: 005_dash_reply_text_cleanup.sql removes retired job state.)
DELETE FROM dash_sync_state WHERE job = 'heyreach-leads';
