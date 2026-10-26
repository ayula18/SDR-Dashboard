-- ═══════════════════════════════════════════════════════════════════════════
-- The resolved company, stored on the row instead of computed on every read.
--
-- WHY: 018 put the identity closure (own domain → company page → stated name →
-- canonical domain) in dash_v_linkedin_leads as a COALESCE over three LEFT
-- JOINs. A computed column cannot be indexed, so any query filtering on
-- company_domain has to build the whole view and then filter it.
--
-- dash_v_meetings does exactly that, once per meeting, to attribute each one to
-- a campaign. Measured 2026-10-26: 64.1s for 663 meetings — 63.7s of it the
-- LinkedIn arm, materialising 6,271 rows on every loop, while the email arm
-- index-seeks the same work in 0.3s. The program page timed out at 60s.
--
-- CLAUDE.md already said this: canonical maps are MATERIALISED into dash_*
-- tables, never joined live. The closure now runs once per sync, in the
-- company-identity job, and the view reads two plain indexed columns.
--
-- Staleness: a person synced after the last company-identity run has their own
-- resolved domain but no closure yet, so the view falls back to it with
-- COALESCE(canonical_domain, company_domain) — one column, no join. The next run
-- fills the rest. company-identity runs first in DEFAULT_SEQUENCE.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_linkedin_leads
  ADD COLUMN IF NOT EXISTS canonical_domain text,
  ADD COLUMN IF NOT EXISTS company_identity text;  -- person | page | name | none

-- The index the meetings lateral needs, and every other company filter with it.
CREATE INDEX IF NOT EXISTS idx_dash_li_leads_canonical
  ON dash_linkedin_leads (canonical_domain);
