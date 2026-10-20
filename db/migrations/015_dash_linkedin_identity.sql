-- ═══════════════════════════════════════════════════════════════════════════
-- What HeyReach already knows about a person, and we were throwing away.
--
-- Every lead from /campaign/GetLeadsFromCampaign carries linkedInUserProfile
-- with `companyUrl` (the company's LinkedIn page — a globally unique id) and
-- `emailAddress` / `enrichedEmailAddress` (a work email). Measured over 162
-- people in three live campaigns: companyUrl on 80.9%, a work email on 75.9%,
-- one or the other on 97.5%.
--
-- The sync stored only `companyName` — the single weakest field — and resolved
-- a company by matching that string against a registry. That is why a third of
-- LinkedIn companies had no domain, could not be deduped against email, and
-- could never be credited a meeting.
--
-- identity_source records which rung of the waterfall answered, so the page can
-- say how many companies are known exactly and how many were inferred. A
-- leadership number that cannot state its own precision is not a leadership
-- number.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_linkedin_leads ADD COLUMN IF NOT EXISTS company_url      text;
ALTER TABLE dash_linkedin_leads ADD COLUMN IF NOT EXISTS work_email       text;
ALTER TABLE dash_linkedin_leads ADD COLUMN IF NOT EXISTS identity_source  text;

CREATE INDEX IF NOT EXISTS dash_linkedin_leads_company_url_idx
  ON dash_linkedin_leads (company_url) WHERE company_url IS NOT NULL;
