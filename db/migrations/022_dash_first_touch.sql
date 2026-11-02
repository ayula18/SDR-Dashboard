-- ═══════════════════════════════════════════════════════════════════════════
-- First touch: when a lead got its first email.
--
-- WHY: "companies reached in a range" was decided by each lead's LAST contact,
-- the only send time Instantly's lead object carries. A follow-up therefore
-- moved a lead, and its company, out of the week it was first emailed and into
-- the week of its latest follow-up. Against every send in the archive the
-- weekly count was 18-36% low (week of 28 Sep: 145 shown, 226 emailed).
--
-- Ayush, 2026-11-02: a company is reached by the first email, not by the
-- follow-ups, so ranges count leads by when they were first emailed.
--
-- Filled from two places, both taking the EARLIEST value ever seen:
--   email-first-touch  the first archived send to this person in this campaign
--                      (ctx_events, read only; covers sends from about May 2026)
--   instantly-leads    the lead's last-contact time, the first time a sync sees
--                      it contacted; runs every few minutes, so going forward
--                      this is the first email to within a sync interval
-- dash_v_leads falls back to last_contact_at where neither has an answer.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ ADDITIVE. Only adds a column and an index to a dash_* table.            │
-- └─────────────────────────────────────────────────────────────────────────┘
-- IDEMPOTENT — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_leads ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dash_leads_first_contact ON dash_leads (first_contact_at);
