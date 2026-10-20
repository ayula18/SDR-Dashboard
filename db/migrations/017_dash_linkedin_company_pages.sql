-- ═══════════════════════════════════════════════════════════════════════════
-- A company's LinkedIn page, mapped to its domain.
--
-- Two people at the same company page are at the same company — that is what a
-- company page IS. But resolution runs per person, so one person at
-- linkedin.com/company/armadin resolved to armadin.com through the archive
-- while three others, with the same page and no other evidence, resolved to
-- nothing. The page list then showed Armadin three times: once as armadin.com,
-- once as li:linkedin.com/company/armadin, once as name:armadin.
--
-- This closes that: whatever domain the people on a page did resolve to, the
-- ones who resolved to nothing inherit. It fills a GAP only — a person with
-- their own answer keeps it, which matters because someone whose profile still
-- says Armadin but whose work email is @dataminr.com has moved, and their own
-- email is the better answer for them.
--
-- Filled by the company-identity job from two sources: the registry's
-- company_linkedin_url, and the pages our own outreach has already resolved.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_linkedin_company_domains (
  company_url text PRIMARY KEY,
  domain      text NOT NULL,
  source      text NOT NULL,
  note        text,
  synced_at   timestamptz NOT NULL DEFAULT NOW()
);

-- Our own company writes outreach under more than one spelling. reo-dev.com was
-- showing on the AI SDR page as a prospect called "Reo-dev".
INSERT INTO dash_internal_domains (domain, note) VALUES
  ('reo-dev.com',   'our own company, alternate spelling'),
  ('reodev.info',   'our own company, alternate spelling'),
  ('reodev.online', 'our own company, alternate spelling'),
  ('reodev.tech',   'our own company, alternate spelling'),
  ('bcl-reo.dev',   'our own company, alternate spelling')
ON CONFLICT (domain) DO NOTHING;
