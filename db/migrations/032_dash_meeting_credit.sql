-- ═══════════════════════════════════════════════════════════════════════════
-- Who booked each meeting and where it came from, decided once.
--
-- WHY (Ayush, 2026-11-08 and 2026-11-10): the Overview's LinkedIn meetings listed
-- prism-ml, Extend and Harness twice each and credited Akhil's harness.io meeting to
-- the KubeCon invite campaign. dash_v_meetings stamped the HubSpot form's SDR on every
-- record within 14 days, merged records only when an alert sat within 3 days of an
-- audit row, and took whichever campaign last reached the company, broadcasts too.
-- "Where we are sure, like the form, treat it as truth; only where we are not very
-- sure, use the waterfall."
--
-- One row per dash_meetings record, rewritten by the meeting-credit job
-- (lib/sync/meeting-credit.js, the rules in lib/outreach/meeting-credit.js) after
-- every meetings sync, from data already held: no API call.
--   merged_into   another record of the same meeting, which speaks for it; this one
--                 counts nowhere
--   company_domain the company, canonical; named for a booking that came without one
--   booking_by    sdr | other | unknown, as dash_v_meetings has always meant it
--   sdrs, shares  who gets the credit and how much: half each only where the audit
--                 sheet splits a meeting between two SDRs
--   campaign_id   the outreach it came from; never a broadcast (031)
--   channel       email | linkedin | call | unknown, which need not have a campaign
--   reason        the decision in words, for the review list and the meetings table
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* objects. IDEMPOTENT — safe to run multiple times.    │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_meeting_credit (
  meeting_id     TEXT PRIMARY KEY REFERENCES dash_meetings(id) ON DELETE CASCADE,
  merged_into    TEXT,
  company_domain TEXT,
  booking_by     TEXT NOT NULL CHECK (booking_by IN ('sdr', 'other', 'unknown')),
  sdrs           TEXT[] NOT NULL DEFAULT '{}',
  shares         NUMERIC[] NOT NULL DEFAULT '{}',
  campaign_id    TEXT,
  channel        TEXT CHECK (channel IN ('email', 'linkedin', 'call', 'unknown')),
  who_by         TEXT,
  who_sure       TEXT,
  where_rung     TEXT,
  where_sure     TEXT,
  person         TEXT,
  reason         TEXT,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dash_meeting_credit_merged ON dash_meeting_credit(merged_into);
