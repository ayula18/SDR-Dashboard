-- ═══════════════════════════════════════════════════════════════════════════
-- The SDR form on HubSpot deals, as the first word on who booked a meeting.
--
-- WHY (Ayush, 2026-11-05): "all sdrs fill up a form in hubspot which exactly
-- captures this info". The form writes two deal properties,
-- date_of_meeting_sdr_form and sdr_owner. The audit sheet's direction said Outbound
-- on Referral and Ads meetings, and its channel said Referral on 9 meetings the form
-- credits to an SDR since 29 Jun.
--
-- One row per deal with the form filled, rewritten by the meetings-sdr-form job
-- (lib/sync/jobs/meetings-sdr-form.js):
--   sdr      the person who booked it, spelled as on the team list
--   not_sdr  the form names something that is not an SDR's outreach: Ads, Inbound,
--            Referral, Ecosystem, Outbound - Old, Cold calling. A blank owner, which is
--            what inbound and AE deals mostly carry, is neither: it says nothing
--   booked_on  the day the deal was created, when that is up to 14 days before the
--            meeting and so can be the day it was booked
--
-- dash_v_meetings reads this at query time rather than copying it onto dash_meetings,
-- because meetings-csv rewrites every audit row.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* objects. IDEMPOTENT — safe to run multiple times.    │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_sdr_form (
  deal_id           TEXT PRIMARY KEY,
  company_domain    TEXT,
  company_name      TEXT,
  meeting_date      DATE NOT NULL,
  owner_raw         TEXT,
  sdr               TEXT,
  not_sdr           BOOLEAN NOT NULL DEFAULT FALSE,
  source_of_meeting TEXT,
  booked_on         DATE,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dash_sdr_form_company ON dash_sdr_form(company_domain, meeting_date);

-- CKEditor is made by CKSource, and the same company came through under both domains:
-- 10 people at cksource.com call their employer CKEditor, and the form holds ckeditor.com
-- for a meeting the alert holds at cksource.com a day earlier. Decided by hand as in 024.
INSERT INTO dash_company_domains (domain, canonical_domain, source, note) VALUES
  ('ckeditor.com', 'cksource.com', 'admin', 'reviewed 2026-11-05: CKEditor, made by CKSource')
ON CONFLICT (domain) DO UPDATE
  SET canonical_domain = EXCLUDED.canonical_domain, source = 'admin', note = EXCLUDED.note, synced_at = NOW();
