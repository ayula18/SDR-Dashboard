-- ═══════════════════════════════════════════════════════════════════════════
-- SDR Dashboard: starting roster and programs
--
-- ON CONFLICT DO NOTHING, so edits made later (roles, aliases, patterns) are
-- never overwritten by a re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Everyone who has run Instantly campaigns or appears in the 2026 allocation.
-- 'other' = seen in campaign or meeting names but not an SDR; kept off leaderboards.
INSERT INTO dash_team (name, aliases, role, color) VALUES
  ('Rama',     '{}',          'sdr',   '#22c55e'),
  ('Harshini', '{harishni}',  'sdr',   '#f59e0b'),
  ('Akhil',    '{}',          'sdr',   '#6366f1'),
  ('Dheeraj',  '{}',          'sdr',   '#06b6d4'),
  ('Sanika',   '{}',          'sdr',   '#ec4899'),
  ('Ahmed',    '{}',          'sdr',   '#a855f7'),
  ('Aarsh',    '{}',          'sdr',   '#14b8a6'),
  ('Muni',     '{}',          'sdr',   '#f97316'),
  ('Suman',    '{}',          'sdr',   '#eab308'),
  ('Muskan',   '{}',          'sdr',   '#8b5cf6'),
  ('Aman',     '{}',          'sdr',   '#0ea5e9'),
  ('Ayush',    '{}',          'sdr',   '#84cc16'),
  ('Akash',    '{}',          'other', '#94a3b8'),
  ('PJ',       '{}',          'other', '#94a3b8'),
  ('Harshit',  '{}',          'other', '#94a3b8'),
  ('Parth',    '{}',          'other', '#94a3b8')
ON CONFLICT (name) DO NOTHING;

-- Program membership comes from campaign names; the POC is who manages it.
INSERT INTO dash_programs (slug, name, poc_name, match_pattern, description, sort_order) VALUES
  ('huggingface',       'HuggingFace',       'Ayush',  'hugging|(^|[^a-z])hf([^a-z]|$)',
     'Companies publishing models on Hugging Face', 10),
  ('common-room',       'Common Room',       'Suman',  'common ?room|cr ?replacement|(^|[^a-z])cr([^a-z]|$)',
     'Accounts using Common Room', 20),
  ('website-deanon',    'Website De-anon',   NULL,     'de-?anon|deano|website.?visitor|rb2b|vector|koala|warmly',
     'Accounts using website visitor de-anonymization tools', 30),
  ('events',            'KubeCon & Events',  'Muni',   'kubecon|cncf|(^|[^a-z])events?([^a-z]|$)',
     'Event and ecosystem outreach', 40),
  ('agents-playground', 'Agents Playground', 'Muskan', 'playground',
     'Agents Playground users', 50),
  ('cto-outreach',      'CTO Reachouts',     'Aman',   '(^|[^a-z])cto([^a-z]|$)',
     'Direct outreach to CTOs', 60)
ON CONFLICT (slug) DO NOTHING;
