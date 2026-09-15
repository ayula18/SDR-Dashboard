-- ═══════════════════════════════════════════════════════════════════════════
-- Website De-anon becomes WVI
--
-- The team calls this program WVI (website visitor identification), and its
-- 2026 campaigns are named that way on both channels, e.g. "Dheeraj-WVI-08/09".
-- Renames the program in place, adds WVI to its pattern, and moves the
-- campaigns already stored, so nothing has to be synced again. Later syncs
-- parse campaign names with the new pattern.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE dash_programs
   SET slug          = 'wvi',
       name          = 'WVI',
       match_pattern = '(^|[^a-z])wvi([^a-z]|$)|de-?anon|deano|website.?visitor|rb2b|vector|koala|warmly',
       description   = 'Website visitor identification, pitched to DevTools companies as a better RB2B or Vector. Includes the 2025 outreach to Koala users.',
       updated_at    = NOW()
 WHERE slug = 'website-deanon';

UPDATE dash_campaign_overrides SET program = 'wvi' WHERE program = 'website-deanon';

UPDATE dash_campaigns
   SET parsed_program = 'wvi'
 WHERE parsed_program = 'website-deanon'
    OR (parsed_program IS NULL AND name ~* '(^|[^a-z])wvi([^a-z]|$)');
