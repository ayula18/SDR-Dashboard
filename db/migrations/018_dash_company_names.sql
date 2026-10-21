-- ═══════════════════════════════════════════════════════════════════════════
-- A stated employer name, mapped to its domain.
--
-- WHY: identity was being decided in three places with three different rules —
-- at resolve time (per person), at page-map time (per LinkedIn page), and AGAIN
-- at read time in a COALESCE inside the metrics layer. They disagreed, so one
-- company could appear as several rows and fixing one place surfaced another.
--
-- The visible failure (Ayush, 2026-10-20): eight people at Armadin resolved to
-- armadin.com and a ninth, with the same stated employer and nothing else,
-- resolved to nothing — so the list showed "armadin.com" and "Armadin" as two
-- separate companies.
--
-- The company page map (017) could not fix that one: the ninth person had no
-- page either. The name they stated is the only signal every person at a
-- company carries, so it is the last rung of the closure.
--
-- SAFETY: a name is only mapped when it resolves to exactly ONE domain across
-- the whole dataset. Measured 2026-10-20: 2,878 names qualify, 178 do not
-- ("pavilion" covers seven different employers, because people list a community
-- they belong to as their company). An ambiguous name is refused outright and
-- those rows keep their own answer — never guessed at.
--
-- Like 017 this fills a GAP only. A person who resolved to a domain keeps it.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_company_names (
  company_key text PRIMARY KEY,   -- companyKey(stated employer), lib/outreach/linkedin.js
  domain      text NOT NULL,      -- already canonical: folded through dash_company_domains
  people      int  NOT NULL DEFAULT 0,
  note        text,
  synced_at   timestamptz NOT NULL DEFAULT NOW()
);
