-- ═══════════════════════════════════════════════════════════════════════════
-- Company identity: one company, one domain.
--
-- Nothing in this app owned the question "are these two rows the same company?".
-- Email keyed a company on its domain; LinkedIn keyed it on a domain when one
-- resolved and on the employer's name when it did not; the funnel joined the two
-- and hoped they collided. They did not. tray.ai and tray.io, alloy.com and
-- usealloy.ai, komodor.io and komodor.com were each counted as two companies.
--
-- The AI SDR app already answers this in `company_groups`: confirmed groups,
-- each with a canonical company. This table is that answer, copied across by the
-- `company-identity` sync job.
--
-- WHY A COPY AND NOT A JOIN: 900_dash_views.sql may only read dash_* tables, so
-- that a migration in the AI SDR app can never be blocked by a view in this one.
-- The views join this table rather than reaching into `companies` themselves.
--
-- group_role = 'acquired' is deliberately NOT mapped (Ayush, 2026-10-19).
-- Splunk was bought by Cisco, but outreach to Splunk is outreach to Splunk;
-- folding 232 LinkedIn people into cisco.com would erase the account the SDRs
-- actually worked. Only 'alias' (one company, several spellings) collapses.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_company_domains (
  domain           text PRIMARY KEY,
  canonical_domain text NOT NULL,
  source           text NOT NULL DEFAULT 'group',
  note             text,
  synced_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dash_company_domains_canonical_idx
  ON dash_company_domains (canonical_domain);

-- Our own people are seeded into campaigns to watch deliverability, so they are
-- not prospects: 17 email leads across 15 campaigns, 3 LinkedIn people and one
-- meeting, four of them counted as replies. OUR_EMAIL_DOMAINS has been in the
-- environment all along and was only ever read by the login gate.
--
-- A table rather than the env var, because a view cannot read the environment
-- and this has to apply in one place for every page at once.
CREATE TABLE IF NOT EXISTS dash_internal_domains (
  domain text PRIMARY KEY,
  note   text
);

INSERT INTO dash_internal_domains (domain, note) VALUES
  ('reo.dev',   'our own company'),
  ('reodev.co', 'our own company')
ON CONFLICT (domain) DO NOTHING;
