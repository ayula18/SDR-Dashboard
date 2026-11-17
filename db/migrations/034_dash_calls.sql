-- ═══════════════════════════════════════════════════════════════════════════
-- Cold calls from Nooks, and the people who make them.
--
-- WHY (Ayush, 2026-11-17): "lets build our call section now in the dashboard. same way
-- we will show metric exacly like email and linkedin. calls made, calls connected to
-- real human, positive respone, meeting etc... my old sdr will start calling a bit late,
-- for noe pranesh and yashika will be making calls."
--
-- dash_calls holds one row per Nooks dialer call, metadata only: no recording, no
-- transcript text, no phone numbers. The `nooks-calls` job (lib/sync/jobs/nooks-calls.js)
-- writes it with GET requests only; the API key could write to Nooks, so nothing else
-- is ever sent. dash_v_calls (900) names the caller and says what counts.
--
-- Pranesh and Yashika join the roster as `caller` (lib/outreach/roles.js): on the SDR
-- page's Call view, and their call bookings count as outreach meetings. The HubSpot form
-- writes "Pranesh - Cold calling"; with Pranesh on the team that names him
-- (lib/outreach/sdr-form.js). A Nooks user is matched to the roster by email, so the
-- three SDRs who have Nooks seats get theirs here.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* objects. IDEMPOTENT — safe to run multiple times.    │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_calls (
  id               TEXT PRIMARY KEY,                  -- the Nooks call id
  called_at        TIMESTAMPTZ NOT NULL,              -- when it was dialed
  owner_id         TEXT,                              -- the Nooks user who dialed
  owner_email      TEXT,                              -- NULL once that user is deleted in Nooks
  owner_name       TEXT,
  direction        TEXT,                              -- outgoing | incoming
  dialing_mode     TEXT,                              -- power | parallel | one-off
  duration_s       INTEGER NOT NULL DEFAULT 0,
  call_label       TEXT,                              -- Nooks' reading of who answered: human | voicemail | machine | phone_tree
  disposition      TEXT,                              -- what the caller picked: "Connected - Positive", "No Answer"…
  call_outcome     TEXT,                              -- the disposition's group: Connect | No Answer | Meeting
  prospect_name    TEXT,
  prospect_email   TEXT,                              -- only for prospects from Apollo; CSV lists carry a name and a number
  prospect_source  TEXT,                              -- csv | apollo | nooks_sep
  has_recording    BOOLEAN NOT NULL DEFAULT FALSE,
  has_transcript   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at_src   TIMESTAMPTZ,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dash_calls_called_at ON dash_calls (called_at);

INSERT INTO dash_team (name, role, email, color) VALUES
  ('Pranesh', 'caller', 'pranesh@reo.dev', '#d946ef'),
  ('Yashika', 'caller', 'yashika@reo.dev', '#3b82f6')
ON CONFLICT (name) DO NOTHING;

-- Their Nooks logins, so their calls are theirs the day they start dialing.
UPDATE dash_team SET email = 'rama@reo.dev', updated_at = NOW() WHERE name = 'Rama' AND email IS NULL;
UPDATE dash_team SET email = 'dheeraj@reo.dev', updated_at = NOW() WHERE name = 'Dheeraj' AND email IS NULL;
UPDATE dash_team SET email = 'ahmed@reo.dev', updated_at = NOW() WHERE name = 'Ahmed' AND email IS NULL;
