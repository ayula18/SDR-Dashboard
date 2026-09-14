-- ═══════════════════════════════════════════════════════════════════════════
-- SDR Dashboard: LinkedIn people in HeyReach campaigns
--
-- HeyReach campaign names never say which companies a campaign targets, but
-- every person's profile names their company. One row per person per campaign,
-- with the company resolved to a domain at sync time (lib/outreach/linkedin.js),
-- so LinkedIn and email outreach meet on the same account. No photos, bios or
-- message text are stored. Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_linkedin_leads (
  campaign_id        TEXT NOT NULL REFERENCES dash_campaigns(id) ON DELETE CASCADE,
  lead_id            TEXT NOT NULL,              -- HeyReach's id for this person in this campaign
  linkedin_id        TEXT,                       -- HeyReach profile id, also stored on archived LinkedIn replies
  person_name        TEXT,
  position           TEXT,
  company_name       TEXT,                       -- as written on the person's profile
  company_key        TEXT,                       -- company_name normalized, the key admin mappings use
  company_domain     TEXT,                       -- resolved at sync time; dash_company_aliases overrides it
  resolution         TEXT,                       -- archive | name | name_emailed | ambiguous | unmatched | no_company
  domain_candidates  TEXT[],                     -- the domains sharing the name, when it was ambiguous
  sender             TEXT,                       -- HeyReach sender account: a senior person, never the SDR
  campaign_status    TEXT,                       -- InSequence | Pending | Finished | Failed | Excluded
  connection_status  TEXT,                       -- None | ConnectionSent | ConnectionAccepted
  message_status     TEXT,                       -- None | MessageSent | MessageReply
  error_code         TEXT,                       -- e.g. AlreadyAConnection, RemovedAccountFromCampaign
  added_at           TIMESTAMPTZ,                -- when the person was added to the campaign
  last_action_at     TIMESTAMPTZ,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_dash_li_leads_linkedin ON dash_linkedin_leads(linkedin_id);
CREATE INDEX IF NOT EXISTS idx_dash_li_leads_domain   ON dash_linkedin_leads(company_domain);
CREATE INDEX IF NOT EXISTS idx_dash_li_leads_company  ON dash_linkedin_leads(company_key);

-- Admin decisions for LinkedIn company names that matched no domain or the wrong
-- one. Keyed by the normalized name, so one decision covers everyone at that
-- company in every campaign, including people synced later.
CREATE TABLE IF NOT EXISTS dash_company_aliases (
  company_key    TEXT PRIMARY KEY,
  company_name   TEXT NOT NULL,
  domain         TEXT,
  not_a_company  BOOLEAN NOT NULL DEFAULT FALSE,  -- "Self-employed", "Stealth", a university
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (domain IS NOT NULL OR not_a_company)
);

-- Who wrote a LinkedIn reply, so the reply can be tied to the campaign that added them.
ALTER TABLE dash_reply_verdicts ADD COLUMN IF NOT EXISTS person_linkedin_id TEXT;
CREATE INDEX IF NOT EXISTS idx_dash_verdicts_linkedin ON dash_reply_verdicts(person_linkedin_id) WHERE person_linkedin_id IS NOT NULL;
