-- ═══════════════════════════════════════════════════════════════════════════
-- The SDRs' positive response sheet, as the ground truth for their positives.
--
-- WHY (Ayush, 2026-11-05): SDRs log every positive reply by hand, in the old
-- tracker ("Responses - 2024") and since July in the assignment sheet ("Positive
-- responses"). For their campaigns that log decides what is positive. AI SDR and
-- other campaigns nobody logs stay on our reply labels.
--
-- dash_sdr_positives holds one row per positive, rewritten daily by the
-- positive-sheet job (lib/sync/jobs/positive-sheet.js). A row moved between the
-- two tabs is one row; the same person logged again months later is a new one.
--   skip_reason    why a logged row does not count: the SDR's own note or mark says
--                  it is not a positive, or it is marked inbound or referral
--   match_kind     how the row was tied to a person (lib/outreach/positive-sheet.js)
--   person_email / linkedin_id   whose replies to show
--   campaign_id / lead_id        the lead in an SDR campaign that gets the credit.
--                  NULL still counts for the SDR and the totals, not for a campaign
--
-- dash_team.logs_positives says whose campaigns the sheet decides: the six SDRs
-- plus the former SDRs who logged there. Muni, Ayush, Muskan and others are not,
-- so their campaigns keep our labels. A new SDR needs this set by hand.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* objects. IDEMPOTENT — safe to run multiple times.    │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_sdr_positives (
  key            TEXT PRIMARY KEY,            -- person:company:day, so it survives rows being inserted above it
  tab            TEXT NOT NULL,               -- old | current
  sheet_row      INTEGER NOT NULL,
  person_name    TEXT,
  company_name   TEXT,
  domain_raw     TEXT,
  company_domain TEXT,                        -- canonical domain (dash_company_domains), when it resolved
  sdr            TEXT,                        -- who the sheet credits, spelled as dash_team
  sdr_raw        TEXT,
  channel        TEXT,                        -- email | linkedin
  sender         TEXT,
  replied_on     DATE,
  date_source    TEXT,                        -- reply | followup | week | position
  status         TEXT,
  notes          TEXT,
  comments       TEXT,
  mark           TEXT,
  skip_reason    TEXT,
  match_kind     TEXT NOT NULL,               -- person | company_reply | other_channel | company | none
  person_email   TEXT,
  linkedin_id    TEXT,
  campaign_id    TEXT,
  lead_id        TEXT,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dash_sdr_positives_day     ON dash_sdr_positives(replied_on);
CREATE INDEX IF NOT EXISTS idx_dash_sdr_positives_lead    ON dash_sdr_positives(channel, lead_id);
CREATE INDEX IF NOT EXISTS idx_dash_sdr_positives_company ON dash_sdr_positives(company_domain);

ALTER TABLE dash_team ADD COLUMN IF NOT EXISTS logs_positives BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE dash_team SET logs_positives = TRUE
 WHERE name IN ('Akhil', 'Ahmed', 'Rama', 'Dheeraj', 'Harshini', 'Suman', 'Sanika', 'Akash');
