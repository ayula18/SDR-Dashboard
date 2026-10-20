-- ═══════════════════════════════════════════════════════════════════════════
-- Shared-root domain pairs that nothing corroborated.
--
-- `company-identity` groups outreach domains by core root (the AI SDR app's
-- extractCoreRoot, copied into lib/outreach/domain-match.js) and then applies
-- that app's rule: a shared root is never enough on its own. A group is merged
-- only when a second signal agrees — the same LinkedIn URL, the same company
-- name, or one domain being a subdomain of another. Everything else lands here
-- and a machine never applies it.
--
-- That rule is not caution for its own sake. The AI SDR app measured it on this
-- database: root-only matches pair elastic.co ("Elastic") with elastic.run
-- ("ElasticRun") and people.inc (Dotdash) with people.ai (People), and about
-- half are wrong. In our own outreach it would merge Delta Air Lines
-- (delta.com) into DeltaBlue (delta.blue), and BuildBuddy into Buddy.
--
-- To accept one: set status = 'merged' and canonical to the domain to keep.
-- To dismiss it: status = 'rejected'. The sync honours both and never
-- re-proposes a row a human has resolved.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_domain_merge_review (
  root        text PRIMARY KEY,
  domains     text[] NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  canonical   text,
  note        text,
  proposed_at timestamptz NOT NULL DEFAULT NOW(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS dash_domain_merge_review_status_idx
  ON dash_domain_merge_review (status);
