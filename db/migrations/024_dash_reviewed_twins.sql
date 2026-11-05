-- ═══════════════════════════════════════════════════════════════════════════
-- More companies counted twice under two domains, reviewed by hand (2026-11-04).
--
-- WHY: an October check of companies reached found the same company under two
-- keys, mostly renames and old domains: quiknode.io and quicknode.com,
-- scrapinghub.com and zyte.com, momentohq.com and gomomento.com. Each counted
-- twice in companies reached, with its replies and meetings split.
--
-- HOW THESE WERE DECIDED: the same way as 023. Per pair, from the registry
-- name of each domain and the company name the leads themselves carry (58
-- people at purestorage.com call their employer Everpure). The canonical is the
-- current name where the company renamed, otherwise the domain the registry
-- (AI SDR `companies`) holds, so firmographics still join.
--
-- The ICP dashboard keeps the same decision in companies.merged_into_id, which
-- the company-identity job also reads (source 'icp'). As of today it has merged
-- nothing and none of these pairs is even a candidate there, so they are here.
--
-- LEFT SEPARATE: celerdata.com / starrocks.io (StarRocks is the open-source
-- project), hashgraph.com / hedera.com (different organisations),
-- consultingsafetykit.com (one lead, unclear). Acquisitions stay separate (013).
--
-- To undo one: DELETE its dash_company_domains row (source = 'admin').
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* rows. IDEMPOTENT — safe to run multiple times.       │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO dash_company_domains (domain, canonical_domain, source, note) VALUES
  ('quiknode.io',              'quicknode.com',         'admin', 'reviewed 2026-11-04: QuickNode, old domain'),
  ('momentohq.com',            'gomomento.com',         'admin', 'reviewed 2026-11-04: Momento'),
  ('scrapinghub.com',          'zyte.com',              'admin', 'reviewed 2026-11-04: Scrapinghub renamed Zyte'),
  ('abnormalsecurity.com',     'abnormal.ai',           'admin', 'reviewed 2026-11-04: Abnormal Security renamed Abnormal AI'),
  ('lucidchart.com',           'lucid.co',              'admin', 'reviewed 2026-11-04: Lucidchart is Lucid Software''s product'),
  ('bunnycdn.com',             'bunny.net',             'admin', 'reviewed 2026-11-04: BunnyCDN renamed bunny.net'),
  ('ideracorp.com',            'idera.com',             'admin', 'reviewed 2026-11-04: Idera'),
  ('aztecprotocol.com',        'aztec.network',         'admin', 'reviewed 2026-11-04: Aztec'),
  ('aristanetworks.com',       'arista.com',            'admin', 'reviewed 2026-11-04: Arista Networks'),
  ('huntresslabs.com',         'huntress.com',          'admin', 'reviewed 2026-11-04: Huntress, old domain'),
  ('stack.ai',                 'stack-ai.com',          'admin', 'reviewed 2026-11-04: Stack AI; the registry holds stack-ai.com'),
  ('acorn.io',                 'obot.ai',               'admin', 'reviewed 2026-11-04: Acorn Labs renamed Obot'),
  ('foxitsoftware.com',        'foxit.com',             'admin', 'reviewed 2026-11-04: Foxit'),
  ('lightbend.com',            'akka.io',               'admin', 'reviewed 2026-11-04: Lightbend renamed Akka'),
  ('develocity.io',            'gradle.com',            'admin', 'reviewed 2026-11-04: Develocity is Gradle Inc''s product'),
  ('develocity.ai',            'gradle.com',            'admin', 'reviewed 2026-11-04: Develocity is Gradle Inc''s product'),
  ('titanml.co',               'doubleword.ai',         'admin', 'reviewed 2026-11-04: TitanML renamed Doubleword'),
  ('hpcaitech.com',            'hpc-ai.com',            'admin', 'reviewed 2026-11-04: HPC-AI Tech'),
  ('cochlear.ai',              'cochl.ai',              'admin', 'reviewed 2026-11-04: Cochlear.ai renamed Cochl'),
  ('unity3d.com',              'unity.com',             'admin', 'reviewed 2026-11-04: Unity, old domain'),
  ('purestorage.com',          'everpuredata.com',      'admin', 'reviewed 2026-11-04: Pure Storage renamed Everpure; its leads say so'),
  ('gonimble-way.com',         'nimbleway.com',         'admin', 'reviewed 2026-11-04: Nimble'),
  ('extenddocai.com',          'extend.ai',             'admin', 'reviewed 2026-11-04: Extend'),
  ('blacktigerpoland.tech',    'blacktiger.tech',       'admin', 'reviewed 2026-11-04: Black Tiger'),
  ('lmarena.ai',               'arena.ai',              'admin', 'reviewed 2026-11-04: LMArena renamed Arena'),
  ('deidentification.co',      'd-id.com',              'admin', 'reviewed 2026-11-04: D-ID (De-Identification Ltd)'),
  ('phasechangesoftware.com',  'phasechange.ai',        'admin', 'reviewed 2026-11-04: Phase Change Software'),
  ('caos.ch',                  'zitadel.com',           'admin', 'reviewed 2026-11-04: CAOS AG renamed Zitadel'),
  ('cloudcasa.io',             'catalogicsoftware.com', 'admin', 'reviewed 2026-11-04: CloudCasa by Catalogic, a product'),
  ('shufti.com',               'shuftipro.com',         'admin', 'reviewed 2026-11-04: Shufti; the registry holds shuftipro.com')
ON CONFLICT (domain) DO UPDATE
  SET canonical_domain = EXCLUDED.canonical_domain, source = 'admin', note = EXCLUDED.note, synced_at = NOW();
