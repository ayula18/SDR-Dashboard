-- ═══════════════════════════════════════════════════════════════════════════
-- AI SDR becomes a program
--
-- Outreach written and sent by the AI SDR agent rather than by a person. It
-- names one campaign per target account ("AI_SDR_Cyber_C1_23/09_cofense.com"),
-- on both channels, so a batch shows up as several campaigns that only the
-- program groups back together.
--
-- The pattern tolerates the separator drifting between "AI_SDR" and "AI SDR".
-- Campaigns whose name carries "Test" stay out of every funnel through the
-- name rule in 900_dash_views.sql, so the first test batches are attributed
-- here but never counted.
--
-- parsed_sdr stays NULL on purpose: no human SDR owns these sends.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO dash_programs (slug, name, poc_name, match_pattern, description, sort_order) VALUES
  ('ai-sdr', 'AI SDR', NULL, '(^|[^a-z])ai[ _-]?sdr([^a-z]|$)',
   'Outreach run end to end by the AI SDR agent, one campaign per target account. First live batch: Cyber C1, 23 Sep 2026.', 70)
ON CONFLICT (slug) DO NOTHING;

UPDATE dash_campaigns
   SET parsed_program = 'ai-sdr'
 WHERE parsed_program IS NULL
   AND name ~* '(^|[^a-z])ai[ _-]?sdr([^a-z]|$)';
