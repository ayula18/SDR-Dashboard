-- ═══════════════════════════════════════════════════════════════════════════
-- When each LinkedIn person got their FIRST message.
--
-- WHY: "messages sent" read HeyReach's per-period counter, which counts every
-- message, follow-ups included. Ayush, 2026-11-04: outreach volumes count the
-- first touch only — the first email on Instantly, and on LinkedIn the invite
-- plus the first message to each person.
--
-- Filled by linkedin-first-message from the HeyReach conversations the AI SDR
-- app archives in ctx_events (read only, no HeyReach call). Each message
-- belongs to the latest campaign that added its person before it went out, as
-- replies do in dash_v_linkedin_leads.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ ADDITIVE. Only adds a column and an index to a dash_* table.            │
-- └─────────────────────────────────────────────────────────────────────────┘
-- IDEMPOTENT — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_linkedin_leads ADD COLUMN IF NOT EXISTS first_message_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dash_li_leads_first_message ON dash_linkedin_leads (first_message_at);
