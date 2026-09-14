-- ═══════════════════════════════════════════════════════════════════════════
-- SDR Dashboard: resolved views
--
-- These views only read dash_* tables. Nothing here depends on AI SDR tables,
-- so this dashboard can never block a migration in that app. Dropped and
-- recreated on every apply, so definitions can change freely. Numbered 900 so
-- it runs after every table migration whose columns it reads.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS dash_v_linkedin_leads;
DROP VIEW IF EXISTS dash_v_meetings;
DROP VIEW IF EXISTS dash_v_leads;
DROP VIEW IF EXISTS dash_v_campaigns;
DROP VIEW IF EXISTS dash_v_reply_verdicts;

-- Reply verdicts, preferring GPT-4.1 mini's label (004_dash_reply_llm.sql) over
-- the rule-based one written at sync time, once the model has read the reply.
--   is_positive  interested or not now (POSITIVE_VERDICTS in lib/metrics/format.js).
--                A reply with no clear intent, such as saying they are already a
--                customer, or from the wrong person is not positive
--   is_negative  declined or unsubscribed
--   is_auto      not a response to our outreach: auto-replies, and off_topic
--                messages such as job requests or people pitching us
CREATE VIEW dash_v_reply_verdicts AS
SELECT
  v.id, v.platform, v.campaign_external_id, v.person_email, v.person_name, v.person_linkedin_id, v.company_domain,
  v.sender, v.replied_at,
  COALESCE(v.llm_verdict, v.verdict) AS verdict,
  COALESCE(v.llm_verdict, v.verdict) IN ('interested', 'deferred') AS is_positive,
  CASE WHEN v.llm_verdict IS NULL THEN v.is_negative ELSE v.llm_verdict IN ('declined', 'unsubscribed') END AS is_negative,
  CASE WHEN v.llm_verdict IS NULL THEN v.is_auto ELSE v.llm_verdict IN ('auto', 'off_topic') END AS is_auto,
  CASE WHEN v.llm_verdict IS NULL THEN 'rules' ELSE 'llm' END AS classifier,
  v.llm_reason AS reason,
  v.quote, v.subject, v.classified_at, v.llm_classified_at
FROM dash_reply_verdicts v;

-- Campaigns with overrides applied. Test, webhook and deliverability-check
-- campaigns are excluded by name so they never inflate a funnel.
CREATE VIEW dash_v_campaigns AS
SELECT
  c.id, c.platform, c.external_id, c.name, c.status, c.created_at_src, c.updated_at_src, c.senders,
  CASE WHEN o.sdr     IS NULL THEN c.parsed_sdr     ELSE NULLIF(o.sdr, '')     END AS sdr,
  CASE WHEN o.program IS NULL THEN c.parsed_program ELSE NULLIF(o.program, '') END AS program,
  CASE WHEN o.theme   IS NULL THEN c.parsed_theme   ELSE NULLIF(o.theme, '')   END AS theme,
  CASE WHEN o.segment IS NULL THEN c.parsed_segment ELSE NULLIF(o.segment, '') END AS segment,
  c.parsed_region AS region,
  (COALESCE(o.excluded, FALSE) OR c.name ~* '(^|[^a-z])(test+|webhook|deliverability)([^a-z]|$)') AS excluded,
  (o.campaign_id IS NOT NULL) AS overridden
FROM dash_campaigns c
LEFT JOIN dash_campaign_overrides o ON o.campaign_id = c.id;

-- Leads with reply outcomes.
--
--   replied   a human replied (reply_count > 0, and not only auto-replies or off-topic messages)
--   negative  replied, and said no: Not Interested / Lost in Instantly,
--             unsubscribed, or the reply was labelled declined or unsubscribed
--   positive  replied, not negative, and a clear yes or not now: a reply labelled
--             interested or not now, or the SDR marked the lead Interested, Meeting
--             booked, Meeting completed or Won in Instantly. A reply with no clear
--             intent or from the wrong person is replied, not positive
CREATE VIEW dash_v_leads AS
WITH verdicts AS (
  SELECT campaign_external_id, person_email,
         bool_or(is_positive) AS any_positive,
         bool_or(is_negative) AS any_negative,
         bool_and(is_auto)    AS only_auto
    FROM dash_v_reply_verdicts
   WHERE platform = 'email' AND person_email IS NOT NULL
   GROUP BY 1, 2
),
base AS (
  SELECT
    l.*,
    c.sdr, c.program, c.theme, c.segment, c.region, c.excluded, c.name AS campaign_name,
    (COALESCE(l.interest_status = 0, FALSE) OR COALESCE(v.only_auto, FALSE)) AS auto_only,
    (COALESCE(l.interest_status IN (-1, -3), FALSE)
       OR COALESCE(l.status = -2, FALSE)
       OR COALESCE(v.any_negative, FALSE)) AS negative_signal,
    (COALESCE(l.interest_status IN (1, 2, 3, 4), FALSE)
       OR COALESCE(v.any_positive, FALSE)) AS positive_signal
  FROM dash_leads l
  JOIN dash_v_campaigns c ON c.id = l.campaign_id
  LEFT JOIN verdicts v ON v.campaign_external_id = c.external_id AND v.person_email = l.email
)
SELECT
  base.*,
  (base.last_contact_at IS NOT NULL)                                                                  AS contacted,
  (base.reply_count > 0 AND NOT base.auto_only)                                                       AS replied,
  (base.reply_count > 0 AND NOT base.auto_only AND base.negative_signal)                              AS negative,
  (base.reply_count > 0 AND NOT base.auto_only AND NOT base.negative_signal AND base.positive_signal)  AS positive
FROM base;

-- Meetings attributed to the campaign that most plausibly produced them: a
-- lead at the same company loaded in the 180 days before the meeting,
-- preferring leads that replied.
CREATE VIEW dash_v_meetings AS
SELECT
  m.*,
  a.campaign_id,
  a.campaign_name,
  a.sdr     AS campaign_sdr,
  a.program,
  a.theme,
  COALESCE(m.sdr_name, CASE WHEN m.channel ILIKE 'sdr%' THEN a.sdr END) AS attributed_sdr,
  (lower(m.happened) = 'yes') AS did_happen
FROM dash_meetings m
LEFT JOIN LATERAL (
  SELECT l.campaign_id, c.name AS campaign_name, c.sdr, c.program, c.theme
    FROM dash_leads l
    JOIN dash_v_campaigns c ON c.id = l.campaign_id AND NOT c.excluded
   WHERE m.company_domain IS NOT NULL
     AND m.meeting_date IS NOT NULL
     AND l.company_domain = m.company_domain
     AND l.created_at_src <  (m.meeting_date + 1)
     AND l.created_at_src >= (m.meeting_date - 180)
   ORDER BY (l.reply_count > 0) DESC, l.last_reply_at DESC NULLS LAST, l.created_at_src DESC
   LIMIT 1
) a ON TRUE;

-- LinkedIn people in HeyReach campaigns (006_dash_linkedin_leads.sql), with admin
-- company mappings applied and what came of each person. Email's rules where they
-- exist:
--
--   invited    a connection request went out (pending or accepted)
--   accepted   the request was accepted
--   messaged   a message went out, after acceptance or to an existing connection
--   reached    invited or messaged
--   replied    a human reply. Once the reply is archived and labelled the labels
--              decide, so auto-replies and off-topic messages don't count;
--              until then HeyReach's own replied status does
--   negative   replied, and a reply was labelled declined or unsubscribed
--   positive   replied, not negative, and a reply was labelled interested or not now
--
-- Each labelled reply belongs to the latest campaign that added its writer before
-- it came in, so someone in two campaigns is not counted as replying twice.
CREATE VIEW dash_v_linkedin_leads AS
WITH attributed AS (
  SELECT DISTINCT ON (v.id)
         l.campaign_id, l.lead_id, v.verdict, v.is_positive, v.is_negative, v.is_auto, v.replied_at
    FROM dash_v_reply_verdicts v
    JOIN dash_linkedin_leads l ON l.linkedin_id = v.person_linkedin_id AND l.added_at <= v.replied_at
   WHERE v.platform = 'linkedin'
   ORDER BY v.id, l.added_at DESC
),
outcome AS (
  SELECT campaign_id, lead_id,
         bool_or(is_positive) AS any_positive,
         bool_or(is_negative) AS any_negative,
         bool_and(is_auto)    AS only_auto,
         -- what this person's replies come to: their latest no when they said one, otherwise
         -- their best reply in the order of REPLY_RANK (lib/metrics/format.js)
         COALESCE(
           (array_agg(verdict ORDER BY replied_at DESC) FILTER (WHERE is_negative))[1],
           (array_agg(verdict ORDER BY array_position(ARRAY['interested', 'deferred', 'not_the_person', 'unknown', 'declined', 'unsubscribed'], verdict))
              FILTER (WHERE NOT is_auto))[1]
         ) AS best_verdict,
         max(replied_at) FILTER (WHERE NOT is_auto) AS last_reply_at
    FROM attributed
   GROUP BY 1, 2
),
base AS (
  SELECT
    l.campaign_id, l.lead_id, l.linkedin_id, l.person_name, l.position, l.company_name, l.company_key,
    CASE WHEN a.company_key IS NULL THEN l.company_domain WHEN a.not_a_company THEN NULL ELSE a.domain END AS company_domain,
    CASE WHEN a.company_key IS NULL THEN COALESCE(l.resolution = 'no_company', FALSE) ELSE a.not_a_company END AS no_company,
    CASE WHEN a.company_key IS NULL THEN l.resolution ELSE 'admin' END AS resolution,
    l.domain_candidates, l.sender, l.campaign_status, l.connection_status, l.message_status, l.error_code,
    l.added_at, l.last_action_at,
    c.sdr, c.program, c.theme, c.excluded, c.name AS campaign_name, c.status AS campaign_state,
    o.best_verdict, o.last_reply_at,
    CASE WHEN o.lead_id IS NULL THEN COALESCE(l.message_status = 'MessageReply', FALSE) ELSE NOT o.only_auto END AS replied,
    COALESCE(o.any_positive, FALSE) AS any_positive,
    COALESCE(o.any_negative, FALSE) AS any_negative
  FROM dash_linkedin_leads l
  JOIN dash_v_campaigns c ON c.id = l.campaign_id
  LEFT JOIN dash_company_aliases a ON a.company_key = l.company_key
  LEFT JOIN outcome o ON o.campaign_id = l.campaign_id AND o.lead_id = l.lead_id
)
SELECT
  base.*,
  COALESCE(base.connection_status IN ('ConnectionSent', 'ConnectionAccepted'), FALSE) AS invited,
  COALESCE(base.connection_status = 'ConnectionAccepted', FALSE)                     AS accepted,
  COALESCE(base.message_status IN ('MessageSent', 'MessageReply'), FALSE)            AS messaged,
  COALESCE(base.connection_status IN ('ConnectionSent', 'ConnectionAccepted')
        OR base.message_status IN ('MessageSent', 'MessageReply'), FALSE)            AS reached,
  (base.replied AND base.any_negative)                                               AS negative,
  (base.replied AND NOT base.any_negative AND base.any_positive)                     AS positive
FROM base;
