-- Reply labels from GPT-4.1 mini (lib/reply-llm.js), kept beside the rule-based verdict.
--
-- Additive only. Sync jobs keep writing the rule columns plus the reply's own words;
-- the reply-classify job fills llm_*; dash_v_reply_verdicts prefers the model's label.

ALTER TABLE dash_reply_verdicts
  ADD COLUMN IF NOT EXISTS subject           TEXT,         -- no longer written: text is read from ctx_events (see 005)
  ADD COLUMN IF NOT EXISTS body              TEXT,         -- no longer written: text is read from ctx_events (see 005)
  ADD COLUMN IF NOT EXISTS llm_verdict       TEXT,         -- same labels as verdict; NULL until labelled, or when the model declined the reply
  ADD COLUMN IF NOT EXISTS llm_reason        TEXT,
  ADD COLUMN IF NOT EXISTS llm_model         TEXT,         -- '<deployment>@<prompt version>'
  ADD COLUMN IF NOT EXISTS llm_input_hash    TEXT,         -- md5 of the archived subject and body the model read
  ADD COLUMN IF NOT EXISTS llm_classified_at TIMESTAMPTZ;
