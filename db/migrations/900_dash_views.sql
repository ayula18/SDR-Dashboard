-- ═══════════════════════════════════════════════════════════════════════════
-- SDR Dashboard: resolved views
--
-- These views only read dash_* tables. Nothing here depends on AI SDR tables,
-- so this dashboard can never block a migration in that app. Dropped and
-- recreated on every apply, so definitions can change freely. Numbered 900 so
-- it runs after every table migration whose columns it reads.
-- ═══════════════════════════════════════════════════════════════════════════

-- dash_v_meetings reads dash_v_linkedin_leads, so it drops first.
DROP VIEW IF EXISTS dash_v_meetings;
DROP VIEW IF EXISTS dash_v_linkedin_leads;
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
--
-- AI SDR is the exception (Ayush, 2026-09-24): the agent's first batches are
-- named "AI_SDR_Test_…", and its programme total is meant to match what
-- Instantly shows for the whole campaign list, so the name rule is not applied
-- to them. An explicit dash_campaign_overrides row still excludes one.
CREATE VIEW dash_v_campaigns AS
SELECT
  c.id, c.platform, c.external_id, c.name, c.status, c.created_at_src, c.updated_at_src, c.senders,
  CASE WHEN o.sdr     IS NULL THEN c.parsed_sdr     ELSE NULLIF(o.sdr, '')     END AS sdr,
  CASE WHEN o.program IS NULL THEN c.parsed_program ELSE NULLIF(o.program, '') END AS program,
  CASE WHEN o.theme   IS NULL THEN c.parsed_theme   ELSE NULLIF(o.theme, '')   END AS theme,
  CASE WHEN o.segment IS NULL THEN c.parsed_segment ELSE NULLIF(o.segment, '') END AS segment,
  c.parsed_region AS region,
  (COALESCE(o.excluded, FALSE)
   OR (c.name ~* '(^|[^a-z])(test+|webhook|deliverability)([^a-z]|$)'
       AND CASE WHEN o.program IS NULL THEN c.parsed_program ELSE NULLIF(o.program, '') END
           IS DISTINCT FROM 'ai-sdr')) AS excluded,
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
    -- company_domain is the CANONICAL domain (dash_company_domains), so every count
    -- downstream keys on the company rather than on whichever spelling Instantly
    -- happened to hold. The original stays beside it for tracing a row back.
    l.id, l.campaign_id, l.email,
    COALESCE(cd.canonical_domain, l.company_domain) AS company_domain,
    l.company_domain AS company_domain_raw,
    l.company_name, l.status, l.interest_status, l.reply_count, l.replied_step,
    l.replied_variant, l.upload_method, l.last_step_id, l.last_sender,
    l.created_at_src, l.last_contact_at, l.last_reply_at, l.interest_changed_at, l.synced_at,
    (idom.domain IS NOT NULL) AS internal,
    c.sdr, c.program, c.theme, c.segment, c.region, c.excluded, c.name AS campaign_name,
    (COALESCE(l.interest_status = 0, FALSE) OR COALESCE(v.only_auto, FALSE)) AS auto_only,
    (COALESCE(l.interest_status IN (-1, -3), FALSE)
       OR COALESCE(l.status = -2, FALSE)
       OR COALESCE(v.any_negative, FALSE)) AS negative_signal,
    (COALESCE(l.interest_status IN (1, 2, 3, 4), FALSE)
       OR COALESCE(v.any_positive, FALSE)) AS positive_signal
  FROM dash_leads l
  JOIN dash_v_campaigns c ON c.id = l.campaign_id
  LEFT JOIN dash_company_domains cd ON cd.domain = l.company_domain
  LEFT JOIN dash_internal_domains idom ON idom.domain = COALESCE(cd.canonical_domain, l.company_domain)
  LEFT JOIN verdicts v ON v.campaign_external_id = c.external_id AND v.person_email = l.email
)
SELECT
  base.*,
  (base.last_contact_at IS NOT NULL)                                                                  AS contacted,
  (base.reply_count > 0 AND NOT base.auto_only)                                                       AS replied,
  (base.reply_count > 0 AND NOT base.auto_only AND base.negative_signal)                              AS negative,
  (base.reply_count > 0 AND NOT base.auto_only AND NOT base.negative_signal AND base.positive_signal)  AS positive
FROM base
-- Our own seeded addresses are not prospects. Dropped here rather than in each
-- query, because a page that forgot would quietly report reo.dev as a company.
WHERE NOT base.internal;


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
resolved AS (
  SELECT
    l.campaign_id, l.lead_id, l.linkedin_id, l.person_name, l.position, l.company_name, l.company_key,
    CASE WHEN a.company_key IS NULL THEN l.company_domain WHEN a.not_a_company THEN NULL ELSE a.domain END AS resolved_domain,
    -- The closure, already applied by the company-identity job (019), admin
    -- aliases included. Read PLAINLY — no CASE, no COALESCE — because
    -- dash_v_meetings filters on it once per meeting and only a bare column can
    -- use idx_dash_li_leads_canonical. Wrapping it cost 64s a query.
    l.canonical_domain AS closed_domain,
    COALESCE(l.company_identity, 'none') AS company_identity,
    CASE WHEN a.company_key IS NULL THEN COALESCE(l.resolution = 'no_company', FALSE) ELSE a.not_a_company END AS no_company,
    CASE WHEN a.company_key IS NULL THEN l.resolution ELSE 'admin' END AS resolution,
    l.domain_candidates, l.sender, l.campaign_status, l.connection_status, l.message_status, l.error_code,
    l.added_at, l.last_action_at, l.company_url, l.identity_source,
    c.sdr, c.program, c.theme, c.excluded, c.name AS campaign_name, c.status AS campaign_state,
    o.best_verdict, o.last_reply_at,
    CASE WHEN o.lead_id IS NULL THEN COALESCE(l.message_status = 'MessageReply', FALSE) ELSE NOT o.only_auto END AS replied,
    COALESCE(o.any_positive, FALSE) AS any_positive,
    COALESCE(o.any_negative, FALSE) AS any_negative
  FROM dash_linkedin_leads l
  JOIN dash_v_campaigns c ON c.id = l.campaign_id
  LEFT JOIN dash_company_aliases a ON a.company_key = l.company_key
  LEFT JOIN outcome o ON o.campaign_id = l.campaign_id AND o.lead_id = l.lead_id
),
-- The admin alias decides which domain a person's employer is; this folds that
-- domain onto its company's canonical one, so LinkedIn and email land on the same
-- key and a company worked on both channels is counted once, not twice.
-- WHICH COMPANY THIS PERSON IS AT — decided here, once, and nowhere else.
--
-- It used to be decided three times with three different rules: per person at
-- sync time, per page in the company-identity job, and AGAIN per row in a
-- COALESCE inside lib/metrics. They disagreed, so one company could show up as
-- several rows ("armadin.com" and "Armadin" side by side), and every fix in one
-- place surfaced a new split in another.
--
-- The closure itself runs ONCE PER SYNC, in the company-identity job, and is
-- stored on the row (019) — not computed here. Each rung fills only the gap the
-- one above left:
--   1 the person's own resolved domain       (lib/outreach/linkedin.js)
--   2 the domain this company's LinkedIn page resolved to   (017)
--   3 the domain this stated employer name resolved to      (018)
-- then folded onto the company's canonical domain (013).
--
-- Computing that here instead cost 64s on dash_v_meetings, which re-runs this
-- view once per meeting: a COALESCE over joins cannot be indexed.
--
-- company_id is what every count groups by. Anything counting companies reads
-- it; nothing rebuilds it. When no rung found a domain the name comes before
-- the page deliberately: everyone at a company states the same employer, while
-- only some of them carry its page, so the name is the key that keeps them
-- together.
base AS (
  SELECT
    r.campaign_id, r.lead_id, r.linkedin_id, r.person_name, r.position, r.company_name, r.company_key,
    r.closed_domain AS company_domain,
    r.resolved_domain AS company_domain_raw,
    COALESCE(r.closed_domain, 'name:' || r.company_key, 'li:' || r.company_url) AS company_id,
    r.company_identity,
    (idom.domain IS NOT NULL) AS internal,
    r.no_company, r.resolution, r.domain_candidates, r.sender, r.campaign_status,
    r.connection_status, r.message_status, r.error_code, r.added_at, r.last_action_at,
    r.company_url, r.identity_source,
    r.sdr, r.program, r.theme, r.excluded, r.campaign_name, r.campaign_state,
    r.best_verdict, r.last_reply_at, r.replied, r.any_positive, r.any_negative
  FROM resolved r
  -- Seven rows; the three closure joins that used to sit here are now a stored
  -- column, which is what makes company_domain indexable (019).
  LEFT JOIN dash_internal_domains idom ON idom.domain = r.closed_domain
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
FROM base
WHERE NOT base.internal;

-- Meetings from three sources, and what outreach may claim of them.
--   'slack'    the booking bot's alert, in the archive the morning after it is booked
--   'sheet'    the qualified-meetings audit, which alone carries qualified and deal value
--   'hubspot'  a first meeting HubSpot knows about that neither of the others has
-- When two describe the same company within three days, the sheet's row is kept,
-- so a meeting is never counted twice.
--
-- WHY attribution is split (Ayush, 2026-10-27): a meeting booked through the website
-- at a company a campaign had emailed was showing as that campaign's, and that SDR's,
-- meeting. Outreach may only claim a meeting an SDR actually booked; anything else
-- that followed recent outreach is flagged beside it, never counted as it.
CREATE VIEW dash_v_meetings AS
WITH m AS (
  -- Canonical company domain, so a meeting lands on the same key as the outreach
  -- that earned it: a meeting at tray.io could otherwise never be attributed to
  -- the campaign that emailed tray.ai.
  SELECT
    COALESCE(cd.canonical_domain, dm.company_domain) AS company_domain,
    dm.company_domain AS company_domain_raw,
    (idom.domain IS NOT NULL) AS internal,
    dm.id, dm.company_raw, dm.meeting_date, dm.week_start, dm.month_start, dm.source_of_meeting,
    dm.channel, dm.direction, dm.sdr_name, dm.qualified, dm.points, dm.deal_value, dm.happened,
    dm.segment, dm.employee_bucket, dm.oss_type, dm.champion_title, dm.senior_champion,
    dm.confidence, dm.source_file, dm.imported_at, dm.source, dm.outcome, dm.evidence_source,
    dm.evidence_note, dm.evidence_at, dm.superseded_by, dm.booking_qualified,
    dm.qualification_note, dm.booking_action, dm.booked_via, dm.heard_from,
    dm.campaign_id AS stated_campaign_id, dm.created_by, dm.entry_note, dm.stated_sdr
  FROM dash_meetings dm
  LEFT JOIN dash_company_domains cd ON cd.domain = dm.company_domain
  LEFT JOIN dash_internal_domains idom ON idom.domain = COALESCE(cd.canonical_domain, dm.company_domain)
)
SELECT
  m.*,
  -- Who booked it, which is what decides whether outreach may claim it:
  --   sdr      an SDR did: the audit sheet names them, they entered the meeting
  --            against their own campaign, the booking link belonged to the SDR
  --            team, or the sheet classified the meeting outbound
  --   other    someone else did: inbound, a referral, an AE, marketing, self-serve
  --   unknown  nothing says who: HubSpot's meeting objects carry no owner
  CASE
    WHEN m.stated_sdr IS NOT NULL THEN 'sdr'
    WHEN m.sdr_name IS NOT NULL THEN 'sdr'
    WHEN m.stated_campaign_id IS NOT NULL THEN 'sdr'
    WHEN m.channel ILIKE 'sdr%' THEN 'sdr'
    WHEN m.source = 'sheet' AND m.direction ILIKE 'outbound' THEN 'sdr'
    WHEN m.channel IS NOT NULL THEN 'other'
    ELSE 'unknown'
  END AS booking_by,
  -- One definition of what outreach may claim, which every page reads:
  --   sourced     an SDR booked it, so the campaign that reached the company owns it
  --   influenced  it arrived another way within 30 days of us reaching that company:
  --               flagged beside the campaign, never counted as its meeting
  --   none        neither, so no campaign, SDR or program is named at all
  CASE
    WHEN COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE) THEN 'sourced'
    WHEN (NOT COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE)
             AND a.last_touch IS NOT NULL AND a.last_touch >= m.meeting_date - 30) THEN 'influenced'
    ELSE 'none'
  END AS attribution,
  -- Campaign, SDR and program name the sourced meeting only, so a page that filters
  -- or groups by them can never count a meeting outreach did not book.
  CASE WHEN COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE) THEN COALESCE(oc.id, a.campaign_id) END     AS campaign_id,
  CASE WHEN COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE) THEN COALESCE(oc.name, a.campaign_name) END AS campaign_name,
  CASE WHEN COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE) THEN COALESCE(oc.sdr, a.sdr) END            AS campaign_sdr,
  CASE WHEN COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE) THEN COALESCE(oc.program, a.program) END    AS program,
  CASE WHEN COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE) THEN COALESCE(oc.theme, a.theme) END        AS theme,
  -- An SDR's own statement outranks the source's guess at who booked it.
  COALESCE(m.stated_sdr, m.sdr_name,
           CASE WHEN m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
                THEN COALESCE(oc.sdr, a.sdr) END)                 AS attributed_sdr,
  -- The outreach a flagged meeting followed, for its badge and the review list.
  CASE WHEN (NOT COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE)
             AND a.last_touch IS NOT NULL AND a.last_touch >= m.meeting_date - 30) THEN a.recent_campaign_id END   AS influenced_campaign_id,
  CASE WHEN (NOT COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE)
             AND a.last_touch IS NOT NULL AND a.last_touch >= m.meeting_date - 30) THEN a.recent_campaign_name END AS influenced_campaign_name,
  CASE WHEN (NOT COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE)
             AND a.last_touch IS NOT NULL AND a.last_touch >= m.meeting_date - 30) THEN a.recent_sdr END           AS influenced_sdr,
  CASE WHEN (NOT COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE)
             AND a.last_touch IS NOT NULL AND a.last_touch >= m.meeting_date - 30) THEN a.recent_program END       AS influenced_program,
  CASE WHEN (NOT COALESCE(m.stated_sdr IS NOT NULL OR m.sdr_name IS NOT NULL OR m.stated_campaign_id IS NOT NULL OR m.channel ILIKE 'sdr%'
             OR (m.source = 'sheet' AND m.direction ILIKE 'outbound'), FALSE)
             AND a.last_touch IS NOT NULL AND a.last_touch >= m.meeting_date - 30) THEN (m.meeting_date - a.last_touch) END AS influenced_days,
  -- m.* already carries outcome, evidence_source and evidence_note, written by the
  -- meetings-evidence job (011) from a waterfall of evidence.
  --
  -- Held means the prospect turned up, which is a claim something has to back: the
  -- audit sheet, a recording with them in the room, or the pipeline moving after.
  -- Until that job has first run, the audit sheet's own column stands in.
  (COALESCE(m.outcome, CASE WHEN lower(m.happened) = 'yes' THEN 'held' END) = 'held') AS did_happen,
  -- A booking that moved keeps its row so the move is visible, but the meeting
  -- is counted once, at the slot it moved to.
  (m.superseded_by IS NOT NULL) AS rescheduled
FROM m
LEFT JOIN LATERAL (
  -- One pass over the outreach that reached this company in the 180 days before the
  -- meeting: the campaign that best explains it, and the last day anyone there was
  -- actually reached, which is what the 30-day influence window measures.
  SELECT
    (array_agg(x.campaign_id   ORDER BY x.replied DESC, x.last_reply_at DESC NULLS LAST, x.reached_at DESC))[1] AS campaign_id,
    (array_agg(x.campaign_name ORDER BY x.replied DESC, x.last_reply_at DESC NULLS LAST, x.reached_at DESC))[1] AS campaign_name,
    (array_agg(x.sdr           ORDER BY x.replied DESC, x.last_reply_at DESC NULLS LAST, x.reached_at DESC))[1] AS sdr,
    (array_agg(x.program       ORDER BY x.replied DESC, x.last_reply_at DESC NULLS LAST, x.reached_at DESC))[1] AS program,
    (array_agg(x.theme         ORDER BY x.replied DESC, x.last_reply_at DESC NULLS LAST, x.reached_at DESC))[1] AS theme,
    max(x.touched_at) FILTER (WHERE x.touched_at < m.meeting_date + 1)::date AS last_touch,
    (array_agg(x.campaign_id   ORDER BY x.touched_at DESC) FILTER (WHERE x.touched_at >= m.meeting_date - 30 AND x.touched_at < m.meeting_date + 1))[1] AS recent_campaign_id,
    (array_agg(x.campaign_name ORDER BY x.touched_at DESC) FILTER (WHERE x.touched_at >= m.meeting_date - 30 AND x.touched_at < m.meeting_date + 1))[1] AS recent_campaign_name,
    (array_agg(x.sdr           ORDER BY x.touched_at DESC) FILTER (WHERE x.touched_at >= m.meeting_date - 30 AND x.touched_at < m.meeting_date + 1))[1] AS recent_sdr,
    (array_agg(x.program       ORDER BY x.touched_at DESC) FILTER (WHERE x.touched_at >= m.meeting_date - 30 AND x.touched_at < m.meeting_date + 1))[1] AS recent_program
    FROM (
      SELECT l.campaign_id, c.name AS campaign_name, c.sdr, c.program, c.theme,
             (l.reply_count > 0) AS replied, l.last_reply_at, l.created_at_src AS reached_at,
             l.last_contact_at AS touched_at
        FROM dash_leads l
        JOIN dash_v_campaigns c ON c.id = l.campaign_id AND NOT c.excluded
       WHERE l.company_domain = m.company_domain
         AND l.created_at_src <  (m.meeting_date + 1)
         AND l.created_at_src >= (m.meeting_date - 180)
      UNION ALL
      SELECT l.campaign_id, l.campaign_name, l.sdr, l.program, l.theme,
             l.replied, l.last_reply_at, l.added_at,
             COALESCE(l.last_action_at, l.added_at)
        FROM dash_v_linkedin_leads l
       WHERE l.company_domain = m.company_domain AND NOT l.excluded AND l.reached
         AND l.added_at <  (m.meeting_date + 1)
         AND l.added_at >= (m.meeting_date - 180)
    ) x
   WHERE m.company_domain IS NOT NULL AND m.meeting_date IS NOT NULL
) a ON TRUE
LEFT JOIN dash_v_campaigns oc ON oc.id = m.stated_campaign_id AND NOT oc.excluded
WHERE NOT m.internal
  AND (m.source <> 'slack'
   OR NOT EXISTS (
     SELECT 1
       FROM m sheet
      WHERE sheet.source = 'sheet'
        AND sheet.company_domain IS NOT NULL
        AND sheet.company_domain = m.company_domain
        AND sheet.meeting_date BETWEEN m.meeting_date - 3 AND m.meeting_date + 3
   ));
