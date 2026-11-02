-- ═══════════════════════════════════════════════════════════════════════════
-- Company merges, reviewed by hand (2026-11-02, Ayush asked for the review).
--
-- WHY: the company-identity job only proposes domains that share a core root,
-- and queues every one that no second signal corroborates (014). Nothing could
-- resolve that queue, so 74 groups sat 'pending' — and domains that are one
-- company under DIFFERENT roots were never proposed at all: dbtlabs.com (92
-- leads) and getdbt.com (28), starburstdata.com (86) and starburst.io (41),
-- dominodatalab.com and domino.ai, endor.ai and endorlabs.com, repl.it and
-- replit.com. Each was counted as two companies, with its replies, positives
-- and meetings split between them.
--
-- HOW THESE WERE DECIDED: per group, from the registry name and LinkedIn page
-- of each domain, the LinkedIn pages our own HeyReach people carry, and the
-- company name Instantly recorded for the leads. No rule was safe to automate:
--   same-root groups      41 of 74 are one company (55%, as the AI SDR app measured)
--   "lead names agree"    4 false merges among the same-root groups (cobalt, mage, socket, imply)
--   shared registry page  11 of 13 right; predibase.com sits on Rubrik's page
--   same registry name    mostly right, but acquisitions inherit the buyer's name
--
-- ACQUISITIONS STAY SEPARATE (013, Ayush 2026-10-19: outreach to Splunk is
-- outreach to Splunk): tecton.ai/Databricks, observo.ai/SentinelOne,
-- fugue.co/Snyk, getcensus.com/Fivetran, vintela.com/Quest,
-- predibase.com/Rubrik, get-potions.com/AB Tasty are deliberately not here.
-- Left undecided for want of evidence: laminar.com (on two LinkedIn pages),
-- river.ai, resolve.ai, echo.ai, sieve.ai, workweave.ai, wisdom.ai and similar.
--
-- To undo one: DELETE its dash_company_domains row (source = 'admin'), or set
-- a review row back to 'pending'. The next company-identity run follows either.
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* rows. IDEMPOTENT — safe to run multiple times.       │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ── One company under different roots: an admin mapping each ─────────────
INSERT INTO dash_company_domains (domain, canonical_domain, source, note) VALUES
  ('agilebits.com',            '1password.com',        'admin', 'reviewed 2026-11-02: 1Password''s legal entity'),
  ('sevenai.com',              '7ai.com',              'admin', 'reviewed 2026-11-02: 7AI'),
  ('deeplake.ai',              'activeloop.ai',        'admin', 'reviewed 2026-11-02: Activeloop product, same LinkedIn page'),
  ('squared.ai',               'aisquared.ai',         'admin', 'reviewed 2026-11-02: AI Squared, same LinkedIn page'),
  ('aws.dev',                  'amazon.com',           'admin', 'reviewed 2026-11-02: AWS'),
  ('anysphere.inc',            'cursor.com',           'admin', 'reviewed 2026-11-02: Anysphere makes Cursor'),
  ('anysphere.co',             'cursor.com',           'admin', 'reviewed 2026-11-02: Anysphere makes Cursor'),
  ('codee.com',                'appentra.com',         'admin', 'reviewed 2026-11-02: Codee by Appentra'),
  ('bedrock.security',         'bedrockdata.ai',       'admin', 'reviewed 2026-11-02: Bedrock Security'),
  ('bitsighttech.com',         'bitsight.com',         'admin', 'reviewed 2026-11-02: BitSight'),
  ('bonitasoftnow.com',        'bonitasoft.com',       'admin', 'reviewed 2026-11-02: Bonitasoft'),
  ('cartodb.com',              'carto.com',            'admin', 'reviewed 2026-11-02: CARTO, former domain'),
  ('castai.co',                'cast.ai',              'admin', 'reviewed 2026-11-02: CAST AI'),
  ('smartcontract.com',        'chainlinklabs.com',    'admin', 'reviewed 2026-11-02: Chainlink Labs'),
  ('clearml.ai',               'clear.ml',             'admin', 'reviewed 2026-11-02: ClearML'),
  ('clever-cloud.com',         'clever.cloud',         'admin', 'reviewed 2026-11-02: Clever Cloud'),
  ('topoteretes.com',          'cognee.ai',            'admin', 'reviewed 2026-11-02: Cognee''s legal entity'),
  ('collinearai.info',         'collinear.ai',         'admin', 'reviewed 2026-11-02: Collinear AI'),
  ('contrastsecurityhq.com',   'contrastsecurity.com', 'admin', 'reviewed 2026-11-02: Contrast Security'),
  ('dagster.io',               'dagsterlabs.com',      'admin', 'reviewed 2026-11-02: Dagster Labs'),
  ('getdbt.com',               'dbtlabs.com',          'admin', 'reviewed 2026-11-02: dbt Labs'),
  ('dominodatalab.com',        'domino.ai',            'admin', 'reviewed 2026-11-02: Domino Data Lab, current domain'),
  ('devdrizz.com',             'drizz.dev',            'admin', 'reviewed 2026-11-02: Drizz'),
  ('dryrun.security',          'dryrunsecurity.com',   'admin', 'reviewed 2026-11-02: DryRun Security'),
  ('duosecurity.com',          'duo.com',              'admin', 'reviewed 2026-11-02: Duo Security'),
  ('dwavesys.com',             'dwavequantum.com',     'admin', 'reviewed 2026-11-02: D-Wave, former domain'),
  ('endor.ai',                 'endorlabs.com',        'admin', 'reviewed 2026-11-02: Endor Labs'),
  ('equixely.com',             'equixly.com',          'admin', 'reviewed 2026-11-02: Equixly, misspelt domain'),
  ('infobytesec.com',          'faradaysec.com',       'admin', 'reviewed 2026-11-02: Faraday by Infobyte'),
  ('5tran.co',                 'fivetran.com',         'admin', 'reviewed 2026-11-02: Fivetran'),
  ('forest.app',               'forestadmin.com',      'admin', 'reviewed 2026-11-02: Forest Admin, same LinkedIn page'),
  ('gravitee.io',              'graviteesource.com',   'admin', 'reviewed 2026-11-02: Gravitee, staff email on graviteesource.com'),
  ('githedgehog.com',          'hedgehog.cloud',       'admin', 'reviewed 2026-11-02: Hedgehog'),
  ('imaginationtech.com',      'imgtec.com',           'admin', 'reviewed 2026-11-02: Imagination Technologies'),
  ('getnuvo.com',              'ingestro.com',         'admin', 'reviewed 2026-11-02: nuvo renamed Ingestro'),
  ('instill.tech',             'instill-ai.com',       'admin', 'reviewed 2026-11-02: Instill AI'),
  ('juicedata.io',             'juicefs.com',          'admin', 'reviewed 2026-11-02: Juicedata makes JuiceFS'),
  ('layerzerolabs.org',        'layerzero.network',    'admin', 'reviewed 2026-11-02: LayerZero Labs'),
  ('ltx.io',                   'lightricks.com',       'admin', 'reviewed 2026-11-02: LTX is Lightricks'' product'),
  ('refractionpoint.com',      'limacharlie.io',       'admin', 'reviewed 2026-11-02: LimaCharlie''s legal entity'),
  ('instabug.com',             'luciq.ai',             'admin', 'reviewed 2026-11-02: Instabug renamed Luciq'),
  ('s2search.io',              'marqo.ai',             'admin', 'reviewed 2026-11-02: Marqo'),
  ('mindsdb.com.com',          'mindsdb.com',          'admin', 'reviewed 2026-11-02: MindsDB, mistyped domain'),
  ('minio.io',                 'min.io',               'admin', 'reviewed 2026-11-02: MinIO'),
  ('teammobot.com',            'mobot.io',             'admin', 'reviewed 2026-11-02: Mobot'),
  ('nightfallai.com',          'nightfall.ai',         'admin', 'reviewed 2026-11-02: Nightfall AI'),
  ('nudge-security.com',       'nudgesecurity.com',    'admin', 'reviewed 2026-11-02: Nudge Security'),
  ('oligosecurity.io',         'oligo.security',       'admin', 'reviewed 2026-11-02: Oligo Security'),
  ('oxide.computer',           'oxidecomputer.com',    'admin', 'reviewed 2026-11-02: Oxide Computer Company'),
  ('pdf-tools.com',            'pdftools.com',         'admin', 'reviewed 2026-11-02: PDF Tools'),
  ('pcysys.com',               'pentera.io',           'admin', 'reviewed 2026-11-02: Pcysys renamed Pentera'),
  ('phoenixdata.ai',           'celerdata.com',        'admin', 'reviewed 2026-11-02: CelerData / PhoenixAI, same LinkedIn page'),
  ('platformatichq.com',       'platformatic.dev',     'admin', 'reviewed 2026-11-02: Platformatic'),
  ('pointfive-demo.com',       'pointfive.co',         'admin', 'reviewed 2026-11-02: PointFive'),
  ('poly-ai.com',              'poly.ai',              'admin', 'reviewed 2026-11-02: PolyAI'),
  ('poweredbyprisma.com',      'prisma.io',            'admin', 'reviewed 2026-11-02: Prisma'),
  ('viva64.com',               'pvs-studio.com',       'admin', 'reviewed 2026-11-02: PVS-Studio, former domain'),
  ('qlikview.com',             'qlik.com',             'admin', 'reviewed 2026-11-02: Qlik'),
  ('railway.app',              'railway.com',          'admin', 'reviewed 2026-11-02: Railway'),
  ('rainforestapp.com',        'rainforestqa.com',     'admin', 'reviewed 2026-11-02: Rainforest QA'),
  ('redoc.ly',                 'redocly.com',          'admin', 'reviewed 2026-11-02: Redocly'),
  ('bucket.co',                'reflag.com',           'admin', 'reviewed 2026-11-02: Bucket renamed Reflag'),
  ('repl.it',                  'replit.com',           'admin', 'reviewed 2026-11-02: Replit, former domain'),
  ('re-tell.ai',               'retellai.com',         'admin', 'reviewed 2026-11-02: Retell AI'),
  ('2dimensions.com',          'rive.app',             'admin', 'reviewed 2026-11-02: 2Dimensions renamed Rive'),
  ('rutterapi.com',            'rutter.com',           'admin', 'reviewed 2026-11-02: Rutter'),
  ('scaleopsoptimization.com', 'scaleops.com',         'admin', 'reviewed 2026-11-02: ScaleOps'),
  ('seal-security.com',        'seal.security',        'admin', 'reviewed 2026-11-02: Seal Security'),
  ('sealsecurity.io',          'seal.security',        'admin', 'reviewed 2026-11-02: Seal Security'),
  ('semaphoreci.com',          'semaphore.io',         'admin', 'reviewed 2026-11-02: Semaphore'),
  ('siftscience.com',          'sift.com',             'admin', 'reviewed 2026-11-02: Sift Science renamed Sift'),
  ('simplaistudio.com',        'simplai.ai',           'admin', 'reviewed 2026-11-02: SimplAI'),
  ('simscale-engineering.us',  'simscale.com',         'admin', 'reviewed 2026-11-02: SimScale'),
  ('solacesystems.com',        'solace.com',           'admin', 'reviewed 2026-11-02: Solace'),
  ('spiceai.io',               'spice.ai',             'admin', 'reviewed 2026-11-02: Spice AI'),
  ('sqreamtech.com',           'sqream.com',           'admin', 'reviewed 2026-11-02: SQream'),
  ('starburst.io',             'starburstdata.com',    'admin', 'reviewed 2026-11-02: Starburst'),
  ('superblockshq.com',        'superblocks.com',      'admin', 'reviewed 2026-11-02: Superblocks'),
  ('trufflesecurity.com',      'trufflesec.com',       'admin', 'reviewed 2026-11-02: Truffle Security'),
  ('ubnt.com',                 'ui.com',               'admin', 'reviewed 2026-11-02: Ubiquiti'),
  ('datacrunch.io',            'verda.com',            'admin', 'reviewed 2026-11-02: DataCrunch renamed Verda'),
  ('spotqa.com',               'virtuosoqa.com',       'admin', 'reviewed 2026-11-02: SpotQA renamed Virtuoso QA'),
  ('zadarastorage.com',        'zadara.com',           'admin', 'reviewed 2026-11-02: Zadara'),
  ('zstack-cloud.com',         'zstack.io',            'admin', 'reviewed 2026-11-02: ZStack'),
  ('netbraintech.com',         'netbrain.com',         'admin', 'reviewed 2026-11-02: NetBrain, same LinkedIn page'),
  ('arangodb.com',             'arango.ai',            'admin', 'reviewed 2026-11-02: ArangoDB renamed Arango, same LinkedIn page'),
  ('kubedb.com',               'appscode.com',         'admin', 'reviewed 2026-11-02: KubeDB by AppsCode, same LinkedIn page'),
  ('causaldynamics.com',       'cielara.ai',           'admin', 'reviewed 2026-11-02: Causal Dynamics Lab renamed Cielara, same LinkedIn page'),
  ('jigsawstack.com',          'interfaze.ai',         'admin', 'reviewed 2026-11-02: JigsawStack renamed Interfaze, same LinkedIn page'),
  ('promptql.io',              'hasura.io',            'admin', 'reviewed 2026-11-02: PromptQL by Hasura, same LinkedIn page'),
  ('mozilla.com',              'mozilla.org',          'admin', 'reviewed 2026-11-02: Mozilla Corporation; mozilla.ai is a separate company')
ON CONFLICT (domain) DO UPDATE
  SET canonical_domain = EXCLUDED.canonical_domain, source = 'admin', note = EXCLUDED.note, synced_at = NOW();

-- ── Shared-root groups: one company ───────────────────────────────────────
UPDATE dash_domain_merge_review r
   SET status = 'merged', canonical = v.canonical, resolved_at = NOW(),
       note = 'reviewed 2026-11-02: one company. ' || COALESCE(r.note, '')
  FROM (VALUES
    ('8090', '8090.ai'), ('akave', 'akave.com'), ('amazon', 'amazon.com'), ('appsecure', 'appsecure.security'),
    ('armorcode', 'armorcode.com'), ('botgauge', 'botgauge.com'), ('clerk', 'clerk.com'), ('clockwork', 'clockwork.io'),
    ('copilotkit', 'copilotkit.ai'), ('elementum', 'elementum.ai'), ('embarcadero', 'embarcadero.com'), ('emqx', 'emqx.com'),
    ('euno', 'euno.co'), ('gradle', 'gradle.com'), ('hcl', 'hcl.com'), ('hpc-ai', 'hpc-ai.com'), ('inedo', 'inedo.com'),
    ('inigo', 'inigo.io'), ('invisible', 'invisible.co'), ('itilite', 'itilite.com'), ('kusho', 'kusho.ai'),
    ('layerzero', 'layerzero.network'), ('massa', 'massa.net'), ('microsoft', 'microsoft.com'), ('moengage', 'moengage.com'),
    ('openmind', 'openmind.com'), ('overwatchdata', 'overwatchdata.ai'), ('plexicus', 'plexicus.ai'),
    ('pushsecurity', 'pushsecurity.com'), ('rewind', 'rewind.com'), ('rivet', 'rivet.dev'), ('rstudio', 'rstudio.com'),
    ('safetyculture', 'safetyculture.com'), ('superops', 'superops.com'), ('synadia', 'synadia.com'),
    ('tensoropera', 'tensoropera.ai'), ('vates', 'vates.tech'), ('virtana', 'virtana.com'), ('wandb', 'wandb.ai'),
    ('widefield', 'widefield.ai')
  ) AS v(root, canonical)
 WHERE r.root = v.root AND r.status = 'pending' AND v.canonical = ANY(r.domains);

-- ── Shared-root groups: different companies ───────────────────────────────
UPDATE dash_domain_merge_review r
   SET status = 'rejected', resolved_at = NOW(),
       note = 'reviewed 2026-11-02: different companies. ' || COALESCE(r.note, '')
 WHERE r.status = 'pending' AND r.root IN (
   'abacus', 'autonomi', 'buddy', 'clear', 'clouddefense', 'cobalt', 'com', 'defined', 'delta', 'form', 'hubble',
   'hydra', 'iimcal', 'imply', 'kai', 'kite', 'lem', 'maestro', 'mage', 'mozilla', 'onyx', 'platform', 'platform9',
   'safe', 'scale', 'seal', 'shade', 'shield', 'socket', 'solo', 'stream', 'swift', 'tempo', 'tilde');
