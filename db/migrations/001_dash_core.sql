-- ═══════════════════════════════════════════════════════════════════════════
-- SDR Dashboard: core tables
--
-- Lives in the database shared with the AI SDR app, so it can read companies,
-- ctx_events and sdr_users directly. Every object here is prefixed dash_ and
-- the migration is strictly additive: no DROP, ALTER or DELETE against any
-- table it did not create. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- Who runs outreach. `name` is the first name that starts campaign names
-- ("Akhil_ShortOSS-June2026"). Only role = 'sdr' appears on leaderboards.
CREATE TABLE IF NOT EXISTS dash_team (
  name        TEXT PRIMARY KEY,
  aliases     TEXT[] NOT NULL DEFAULT '{}',     -- other spellings seen in names and sheets, lowercase
  role        TEXT NOT NULL DEFAULT 'sdr',       -- sdr | other
  email       TEXT,
  color       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Specialized programs. A campaign belongs to the first active program (by
-- sort_order) whose pattern matches its name, unless overridden.
CREATE TABLE IF NOT EXISTS dash_programs (
  slug          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  poc_name      TEXT,
  match_pattern TEXT NOT NULL,                   -- case-insensitive regex, valid in both JS and Postgres
  description   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per outreach campaign on any platform.
CREATE TABLE IF NOT EXISTS dash_campaigns (
  id              TEXT PRIMARY KEY,              -- '<platform>:<external_id>'
  platform        TEXT NOT NULL,                 -- instantly | heyreach
  external_id     TEXT NOT NULL,
  name            TEXT NOT NULL,
  status          TEXT,                          -- active | paused | completed | draft | other
  status_raw      TEXT,
  created_at_src  TIMESTAMPTZ,
  updated_at_src  TIMESTAMPTZ,
  parsed_sdr      TEXT,
  parsed_program  TEXT,
  parsed_theme    TEXT,
  parsed_segment  TEXT,
  parsed_region   TEXT,
  senders         TEXT[] NOT NULL DEFAULT '{}',  -- HeyReach sender accounts: senior people, never the SDR
  sequence        JSONB,                          -- [{step (0-based), delay, variants: [{subject, preview}]}]
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_dash_campaigns_sdr     ON dash_campaigns(parsed_sdr);
CREATE INDEX IF NOT EXISTS idx_dash_campaigns_program ON dash_campaigns(parsed_program);

-- Manual corrections to the name parser. NULL keeps the parsed value, '' clears it.
CREATE TABLE IF NOT EXISTS dash_campaign_overrides (
  campaign_id TEXT PRIMARY KEY REFERENCES dash_campaigns(id) ON DELETE CASCADE,
  sdr         TEXT,
  program     TEXT,
  theme       TEXT,
  segment     TEXT,
  excluded    BOOLEAN NOT NULL DEFAULT FALSE,    -- tests, warmups, deliverability checks
  note        TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lifetime totals as the platform reports them.
CREATE TABLE IF NOT EXISTS dash_campaign_stats (
  campaign_id          TEXT PRIMARY KEY REFERENCES dash_campaigns(id) ON DELETE CASCADE,
  leads                INTEGER,
  sent                 INTEGER,
  contacted            INTEGER,
  new_leads_contacted  INTEGER,
  replies_unique       INTEGER,
  auto_replies_unique  INTEGER,
  bounced              INTEGER,
  unsubscribed         INTEGER,
  completed            INTEGER,
  opportunities        INTEGER,
  opportunity_value    NUMERIC,
  connections_sent     INTEGER,
  connections_accepted INTEGER,
  messages_sent        INTEGER,
  message_replies      INTEGER,
  inmails_sent         INTEGER,
  inmail_replies       INTEGER,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform-reported activity per campaign per week (Monday start) or calendar
-- month. Only periods with some activity are stored.
CREATE TABLE IF NOT EXISTS dash_campaign_periods (
  campaign_id          TEXT NOT NULL REFERENCES dash_campaigns(id) ON DELETE CASCADE,
  grain                TEXT NOT NULL CHECK (grain IN ('week', 'month')),
  period_start         DATE NOT NULL,
  sent                 INTEGER NOT NULL DEFAULT 0,
  contacted            INTEGER NOT NULL DEFAULT 0,
  new_leads_contacted  INTEGER NOT NULL DEFAULT 0,
  replies_unique       INTEGER NOT NULL DEFAULT 0,
  auto_replies_unique  INTEGER NOT NULL DEFAULT 0,
  bounced              INTEGER NOT NULL DEFAULT 0,
  unsubscribed         INTEGER NOT NULL DEFAULT 0,
  opportunities        INTEGER NOT NULL DEFAULT 0,
  connections_sent     INTEGER NOT NULL DEFAULT 0,
  connections_accepted INTEGER NOT NULL DEFAULT 0,
  messages_sent        INTEGER NOT NULL DEFAULT 0,
  message_replies      INTEGER NOT NULL DEFAULT 0,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, grain, period_start)
);
CREATE INDEX IF NOT EXISTS idx_dash_periods_period ON dash_campaign_periods(grain, period_start);

-- Performance per sequence step and A/B variant, with the copy that was sent.
CREATE TABLE IF NOT EXISTS dash_campaign_steps (
  campaign_id          TEXT NOT NULL REFERENCES dash_campaigns(id) ON DELETE CASCADE,
  step                 INTEGER NOT NULL,          -- 0-based, as Instantly reports it
  variant              INTEGER NOT NULL,
  subject              TEXT,
  body_preview         TEXT,
  sent                 INTEGER NOT NULL DEFAULT 0,
  replies_unique       INTEGER NOT NULL DEFAULT 0,
  auto_replies_unique  INTEGER NOT NULL DEFAULT 0,
  opportunities        INTEGER NOT NULL DEFAULT 0,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, step, variant)
);

-- Every lead uploaded to Instantly. The allocation record: who was loaded into
-- which campaign when, whether they were contacted, replied, and how.
CREATE TABLE IF NOT EXISTS dash_leads (
  id                   TEXT PRIMARY KEY,          -- Instantly lead id
  campaign_id          TEXT,                      -- dash_campaigns.id
  email                TEXT,
  company_domain       TEXT,
  company_name         TEXT,
  status               INTEGER,                   -- 1 active, 2 paused, 3 completed, -1 bounced, -2 unsubscribed, -3 skipped
  interest_status      INTEGER,                   -- 1 interested, 2 meeting booked, 3 meeting completed, 4 won, 0 out of office, -1 not interested, -2 wrong person, -3 lost
  reply_count          INTEGER NOT NULL DEFAULT 0,
  replied_step         INTEGER,
  replied_variant      INTEGER,
  upload_method        TEXT,
  last_step_id         TEXT,
  last_sender          TEXT,
  created_at_src       TIMESTAMPTZ,               -- when the lead was loaded = allocation date
  last_contact_at      TIMESTAMPTZ,
  last_reply_at        TIMESTAMPTZ,
  interest_changed_at  TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dash_leads_campaign ON dash_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_dash_leads_domain   ON dash_leads(company_domain);
CREATE INDEX IF NOT EXISTS idx_dash_leads_created  ON dash_leads(created_at_src);
CREATE INDEX IF NOT EXISTS idx_dash_leads_reply    ON dash_leads(last_reply_at) WHERE reply_count > 0;
CREATE INDEX IF NOT EXISTS idx_dash_leads_email    ON dash_leads(email);

-- What each inbound reply said, per the reply classifier. "Positive" in this
-- dashboard means any human reply that is neither negative nor automatic.
CREATE TABLE IF NOT EXISTS dash_reply_verdicts (
  id                    TEXT PRIMARY KEY,         -- '<source>:<source event id>'
  platform              TEXT NOT NULL,            -- email | linkedin
  campaign_external_id  TEXT,
  person_email          TEXT,
  person_name           TEXT,
  company_domain        TEXT,
  sender                TEXT,                     -- mailbox or HeyReach sender account
  replied_at            TIMESTAMPTZ,
  verdict               TEXT NOT NULL,            -- interested | deferred | not_the_person | unknown | declined | unsubscribed | auto
  is_negative           BOOLEAN NOT NULL,
  is_auto               BOOLEAN NOT NULL,
  quote                 TEXT,
  classified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dash_verdicts_lead    ON dash_reply_verdicts(campaign_external_id, person_email);
CREATE INDEX IF NOT EXISTS idx_dash_verdicts_replied ON dash_reply_verdicts(platform, replied_at);

-- The "Qualified Meetings 2026 - Happened Audit" sheet: the source of truth for meetings.
CREATE TABLE IF NOT EXISTS dash_meetings (
  id                TEXT PRIMARY KEY,
  company_domain    TEXT,
  company_raw       TEXT,
  meeting_date      DATE,
  week_start        DATE,
  month_start       DATE,
  source_of_meeting TEXT,
  channel           TEXT,                         -- SDR | Referral | Inbound | Ads | Events | …
  direction         TEXT,                         -- Inbound | Outbound
  sdr_name          TEXT,                         -- dash_team.name when the source names a team member
  qualified         BOOLEAN,
  points            NUMERIC,
  deal_value        NUMERIC,
  happened          TEXT,                         -- Yes | No | Manual review | Not yet
  segment           TEXT,
  employee_bucket   TEXT,
  oss_type          TEXT,
  champion_title    TEXT,
  senior_champion   TEXT,
  confidence        TEXT,
  source_file       TEXT,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dash_meetings_domain ON dash_meetings(company_domain);
CREATE INDEX IF NOT EXISTS idx_dash_meetings_date   ON dash_meetings(meeting_date);

-- Sync bookkeeping.
CREATE TABLE IF NOT EXISTS dash_sync_runs (
  id            BIGSERIAL PRIMARY KEY,
  job           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',  -- running | complete | partial | skipped | blocked | failed
  mode          TEXT,
  triggered_by  TEXT,
  stats         JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dash_sync_runs_job ON dash_sync_runs(job, started_at DESC);

CREATE TABLE IF NOT EXISTS dash_sync_state (
  job              TEXT PRIMARY KEY,
  cursor           JSONB,                         -- resume point for long runs
  last_success_at  TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
