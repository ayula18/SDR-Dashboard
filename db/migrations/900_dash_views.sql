-- ═══════════════════════════════════════════════════════════════════════════
-- SDR Dashboard: resolved views
--
-- These views only read dash_* tables. Nothing here depends on AI SDR tables,
-- so this dashboard can never block a migration in that app. Dropped and
-- recreated on every apply, so definitions can change freely. Numbered 900 so
-- it runs after every table migration whose columns it reads.
-- ═══════════════════════════════════════════════════════════════════════════

-- A view drops before anything it reads, or Postgres refuses and the whole file
-- rolls back: meetings reads the LinkedIn people, both people views read the sheet,
-- and the sheet reads campaigns. tests/positive-sheet.test.mjs checks this order.
DROP VIEW IF EXISTS dash_v_meetings;
DROP VIEW IF EXISTS dash_v_linkedin_leads;
DROP VIEW IF EXISTS dash_v_leads;
DROP VIEW IF EXISTS dash_v_sheet_positives;
DROP VIEW IF EXISTS dash_v_campaigns;
DROP VIEW IF EXISTS dash_v_reply_verdicts;

-- Reply verdicts, preferring GPT-4.1 mini's label (004_dash_reply_llm.sql) over
-- the rule-based one written at sync time, once the model has read the reply.
--   is_positive  interested (POSITIVE_VERDICTS in lib/metrics/format.js). Not now stopped
--                counting on 2026-11-05 (Ayush: "without a solid proof dont count"):
--                SDRs log 19% of those, and the ones that mattered here read "not
--                interested at the moment" or an out-of-office. On the sheet it still
--                counts. A reply with no clear intent, such as saying they are already
--                a customer, or from the wrong person is not positive
--   is_negative  declined or unsubscribed
--   is_auto      not a response to our outreach: auto-replies, and off_topic
--                messages such as job requests or people pitching us
CREATE VIEW dash_v_reply_verdicts AS
SELECT
  v.id, v.platform, v.campaign_external_id, v.person_email, v.person_name, v.person_linkedin_id, v.company_domain,
  v.sender, v.replied_at,
  COALESCE(v.llm_verdict, v.verdict) AS verdict,
  COALESCE(v.llm_verdict, v.verdict) IN ('interested') AS is_positive,
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
  (o.campaign_id IS NOT NULL) AS overridden,
  -- Whose positives come from the SDRs' positive response sheet (026). Every other
  -- campaign, AI SDR included, stays on our reply labels (Ayush, 2026-11-05), and so
  -- do programs whose replies are not logged there yet (027). A sheet row can still
  -- land on those: sdr_logs_positives says who can be credited, positives_from_sheet
  -- whether the sheet alone decides.
  COALESCE(t.logs_positives, FALSE) AS sdr_logs_positives,
  (COALESCE(t.logs_positives, FALSE) AND NOT COALESCE(p.positives_from_labels, FALSE)) AS positives_from_sheet,
  -- outreach, or a broadcast (031): event invites, announcements, hiring. A broadcast
  -- keeps its sends and positives but never claims a meeting.
  COALESCE(k.kind, 'outreach') AS kind
FROM dash_campaigns c
LEFT JOIN dash_campaign_overrides o ON o.campaign_id = c.id
LEFT JOIN dash_campaign_kinds k ON k.campaign_id = c.id
LEFT JOIN dash_team t ON t.name = CASE WHEN o.sdr IS NULL THEN c.parsed_sdr ELSE NULLIF(o.sdr, '') END
LEFT JOIN dash_programs p ON p.slug = CASE WHEN o.program IS NULL THEN c.parsed_program ELSE NULLIF(o.program, '') END;

-- The rows of the positive response sheet that count, with what their campaign
-- says. sdr is who the SHEET credits, which can differ from the campaign's owner.
-- campaign_id and lead_id are empty when the person could not be tied to a lead in
-- an SDR campaign: the row still counts for the SDR and the totals.
-- tab 'meeting' is an SDR booking nobody logged, the waterfall's second rung
-- (bookedPositives in lib/outreach/positive-sheet.js); it counts the same way.
CREATE VIEW dash_v_sheet_positives AS
SELECT
  s.key, s.tab, s.channel, s.replied_on, (s.replied_on::timestamp AT TIME ZONE 'UTC') AS replied_at,
  s.person_name, s.company_name, s.company_domain, s.sdr, s.sender, s.status, s.notes, s.comments, s.match_kind,
  s.person_email, s.linkedin_id, s.campaign_id, s.lead_id,
  c.program, c.theme, c.name AS campaign_name, dl.replied_step
FROM dash_sdr_positives s
LEFT JOIN dash_v_campaigns c ON c.id = s.campaign_id
LEFT JOIN dash_leads dl ON s.channel = 'email' AND dl.id = s.lead_id
LEFT JOIN dash_internal_domains idom ON idom.domain = s.company_domain
WHERE s.skip_reason IS NULL AND s.replied_on IS NOT NULL AND idom.domain IS NULL;

-- Leads with reply outcomes.
--
--   replied   a human replied (reply_count > 0, and not only auto-replies or off-topic messages)
--   negative  replied, and said no: Not Interested / Lost in Instantly,
--             unsubscribed, or the reply was labelled declined or unsubscribed
--   positive  logged on the positive response sheet. A person on the sheet has
--             replied and has not said no, whatever the archive holds. In an SDR's
--             campaign nothing else counts (Ayush, 2026-11-05).
--             Any other campaign, and programs still on labels (027): also replied,
--             and a clear yes: a reply labelled interested, or the lead marked
--             Interested, Meeting booked, Meeting completed or Won in Instantly while
--             nothing says no. Someone who started positive stays
--             positive if they say no later (Ayush, 2026-11-05). A reply with no clear
--             intent or from the wrong person is replied, not positive
CREATE VIEW dash_v_leads AS
WITH verdicts AS (
  SELECT campaign_external_id, person_email,
         bool_or(is_positive) AS any_positive,
         bool_or(is_negative) AS any_negative,
         bool_and(is_auto)    AS only_auto,
         min(replied_at) FILTER (WHERE NOT is_auto) AS first_reply_at,
         min(replied_at) FILTER (WHERE is_positive) AS first_positive_at,
         min(replied_at) FILTER (WHERE is_negative) AS first_negative_at
    FROM dash_v_reply_verdicts
   WHERE platform = 'email' AND person_email IS NOT NULL
   GROUP BY 1, 2
),
sheet AS (
  SELECT lead_id, min(replied_at) AS first_at
    FROM dash_v_sheet_positives
   WHERE channel = 'email' AND lead_id IS NOT NULL
   GROUP BY 1
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
    -- WHEN THIS LEAD WAS REACHED: its first email, never a follow-up (022, Ayush
    -- 2026-11-02). Every range that counts reached leads or companies reads this.
    -- LEAST skips a NULL, so a lead the archive never saw falls back to its last contact.
    LEAST(l.first_contact_at, l.last_contact_at) AS first_contact_at,
    -- WHEN EACH OUTCOME LANDED, so it is counted once, on that day (Ayush
    -- 2026-11-04): replied at the first human reply, positive and negative at the
    -- first reply labelled so. Instantly's lead holds only its LAST reply, so the
    -- archive decides; until a reply is archived that last reply stands in.
    COALESCE(v.first_reply_at, l.last_reply_at, sheet.first_at) AS first_reply_at,
    CASE WHEN c.positives_from_sheet OR sheet.lead_id IS NOT NULL THEN sheet.first_at
         ELSE COALESCE(v.first_positive_at, v.first_reply_at, l.last_reply_at) END AS positive_at,
    COALESCE(v.first_negative_at, v.first_reply_at, l.last_reply_at) AS negative_at,
    (idom.domain IS NOT NULL) AS internal,
    c.sdr, c.program, c.theme, c.segment, c.region, c.excluded, c.name AS campaign_name,
    c.positives_from_sheet, (sheet.lead_id IS NOT NULL) AS on_sheet,
    (COALESCE(l.interest_status = 0, FALSE) OR COALESCE(v.only_auto, FALSE)) AS auto_only,
    (COALESCE(l.interest_status IN (-1, -3), FALSE)
       OR COALESCE(l.status = -2, FALSE)
       OR COALESCE(v.any_negative, FALSE)) AS negative_signal,
    (COALESCE(l.interest_status IN (1, 2, 3, 4), FALSE)
       OR COALESCE(v.any_positive, FALSE)) AS positive_signal,
    COALESCE(v.any_positive, FALSE) AS said_yes
  FROM dash_leads l
  JOIN dash_v_campaigns c ON c.id = l.campaign_id
  LEFT JOIN dash_company_domains cd ON cd.domain = l.company_domain
  LEFT JOIN dash_internal_domains idom ON idom.domain = COALESCE(cd.canonical_domain, l.company_domain)
  LEFT JOIN verdicts v ON v.campaign_external_id = c.external_id AND v.person_email = l.email
  LEFT JOIN sheet ON sheet.lead_id = l.id
)
SELECT
  base.*,
  (base.last_contact_at IS NOT NULL)                                                                  AS contacted,
  (base.on_sheet OR (base.reply_count > 0 AND NOT base.auto_only))                                    AS replied,
  (NOT base.on_sheet AND base.reply_count > 0 AND NOT base.auto_only AND base.negative_signal)        AS negative,
  label.labelled_positive,
  (base.on_sheet OR (NOT base.positives_from_sheet AND label.labelled_positive))                      AS positive
FROM base
CROSS JOIN LATERAL (
  SELECT (base.reply_count > 0 AND NOT base.auto_only
          AND (base.said_yes OR (base.positive_signal AND NOT base.negative_signal))) AS labelled_positive
) label
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
--   positive   logged on the positive response sheet. A person on the sheet has
--              replied and has not said no, whatever the archive holds. In an SDR's
--              campaign nothing else counts (Ayush, 2026-11-05).
--              Any other campaign, and programs still on labels (027): also replied
--              and a reply was labelled interested, even if they said no later
--              (Ayush, 2026-11-05)
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
         max(replied_at) FILTER (WHERE NOT is_auto) AS last_reply_at,
         min(replied_at) FILTER (WHERE NOT is_auto) AS first_reply_at,
         min(replied_at) FILTER (WHERE is_positive) AS first_positive_at,
         min(replied_at) FILTER (WHERE is_negative) AS first_negative_at
    FROM attributed
   GROUP BY 1, 2
),
sheet AS (
  SELECT campaign_id, lead_id, min(replied_at) AS first_at
    FROM dash_v_sheet_positives
   WHERE channel = 'linkedin' AND lead_id IS NOT NULL
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
    -- WHEN THIS PERSON WAS REACHED: the first invite or message, never what came
    -- after (Ayush 2026-11-02, as for email). HeyReach reports only the latest action,
    -- which IS the first one while the person has had just an invite, or just a
    -- message; otherwise the day they were added stands in for it (measured on 15,728
    -- invite-only people: invites go out a median 3 hours after adding, 85% the same week).
    CASE WHEN l.last_action_at IS NOT NULL AND (
              (l.connection_status = 'ConnectionSent' AND COALESCE(l.message_status, 'None') = 'None')
           OR (COALESCE(l.connection_status, 'None') = 'None' AND l.message_status = 'MessageSent'))
         THEN l.last_action_at ELSE l.added_at END AS first_touch_at,
    c.sdr, c.program, c.theme, c.excluded, c.name AS campaign_name, c.status AS campaign_state,
    o.best_verdict, o.last_reply_at,
    -- When each outcome landed, as for email. A reply HeyReach reports but the
    -- archive has not caught up with is dated by HeyReach's latest action.
    COALESCE(o.first_reply_at, sheet.first_at, l.last_action_at) AS first_reply_at,
    CASE WHEN c.positives_from_sheet OR sheet.lead_id IS NOT NULL THEN sheet.first_at
         ELSE COALESCE(o.first_positive_at, o.first_reply_at, l.last_action_at) END AS positive_at,
    COALESCE(o.first_negative_at, o.first_reply_at, l.last_action_at) AS negative_at,
    -- The first message to this person in this campaign (025), follow-ups not counted.
    l.first_message_at,
    (sheet.lead_id IS NOT NULL
      OR CASE WHEN o.lead_id IS NULL THEN COALESCE(l.message_status = 'MessageReply', FALSE) ELSE NOT o.only_auto END) AS replied,
    COALESCE(o.any_positive, FALSE) AS any_positive,
    COALESCE(o.any_negative, FALSE) AS any_negative,
    c.positives_from_sheet, (sheet.lead_id IS NOT NULL) AS on_sheet
  FROM dash_linkedin_leads l
  JOIN dash_v_campaigns c ON c.id = l.campaign_id
  LEFT JOIN dash_company_aliases a ON a.company_key = l.company_key
  LEFT JOIN outcome o ON o.campaign_id = l.campaign_id AND o.lead_id = l.lead_id
  LEFT JOIN sheet ON sheet.campaign_id = l.campaign_id AND sheet.lead_id = l.lead_id
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
    r.first_touch_at, r.company_url, r.identity_source,
    r.sdr, r.program, r.theme, r.excluded, r.campaign_name, r.campaign_state,
    r.best_verdict, r.last_reply_at, r.replied, r.any_positive, r.any_negative,
    r.first_reply_at, r.positive_at, r.negative_at, r.first_message_at,
    r.positives_from_sheet, r.on_sheet
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
  (base.replied AND base.any_negative AND NOT base.on_sheet)                         AS negative,
  label.labelled_positive,
  (base.on_sheet OR (NOT base.positives_from_sheet AND label.labelled_positive))     AS positive
FROM base
CROSS JOIN LATERAL (
  SELECT (base.replied AND base.any_positive) AS labelled_positive
) label
WHERE NOT base.internal;

-- Meetings from five sources, each with the credit the meeting-credit job decided.
--   'sheet'    the meetings audit, Combined QMeeings Booked-2026, read daily
--   'slack'    the booking bot's alert, in the archive the morning after it is booked
--   'form'     the SDR form on a HubSpot deal, naming an SDR, where no other source has it
--   'hubspot'  a first meeting HubSpot knows about that none of the others has
--   'manual'   an SDR's own entry on the Meetings page
--
-- WHO BOOKED IT AND WHERE IT CAME FROM are decided once, in lib/outreach/meeting-credit.js,
-- and stored in dash_meeting_credit (032) by the meeting-credit job (Ayush, 2026-11-08:
-- "where we are sure, like the form, treat it as truth; only where we are not very sure
-- put our waterfall model"). This view only reads that decision. It used to make it here,
-- and stamped the form's SDR on every record within 14 days, merged records only when an
-- alert sat within 3 days of an audit row, and took whichever campaign last reached the
-- company, broadcasts too: prism-ml, Extend and Harness each listed twice, and Akhil's
-- harness.io meeting on the KubeCon invite campaign (2026-11-10).
--
-- One row per credited SDR: `share` is 1, or 0.5 each where the audit sheet splits a meeting
-- between two SDRs, so a count of meetings is sum(share), never count(*) (MEETINGS in
-- lib/metrics/sql.js). A record that is a repeat of another (merged_into) is left out; a
-- booking that moved keeps its row, rescheduled, with the credit of the meeting.
CREATE VIEW dash_v_meetings AS
WITH m AS (
  SELECT
    COALESCE(cr.company_domain, cd.canonical_domain, dm.company_domain) AS company_domain,
    dm.company_domain AS company_domain_raw,
    (idom.domain IS NOT NULL) AS internal,
    dm.id, dm.company_raw, dm.meeting_date, dm.week_start, dm.month_start, dm.source_of_meeting,
    dm.channel, dm.direction, dm.sdr_name, dm.qualified, dm.points, dm.deal_value, dm.happened,
    dm.segment, dm.employee_bucket, dm.oss_type, dm.champion_title, dm.senior_champion,
    dm.confidence, dm.source_file, dm.imported_at, dm.source, dm.outcome, dm.evidence_source,
    dm.evidence_note, dm.evidence_at, dm.superseded_by, dm.booking_qualified,
    dm.qualification_note, dm.booking_action, dm.booked_via, dm.heard_from,
    dm.campaign_id AS stated_campaign_id, dm.created_by, dm.entry_note, dm.stated_sdr,
    dm.stated_channel, dm.stated_not_sdr,
    -- The day the form's deal was made, when that can be the booking (028): it dates a
    -- booked positive. Who booked is the credit's, not this.
    form.booked_on AS form_booked_on,
    cr.merged_into, cr.sdrs, cr.shares, cr.campaign_id AS credit_campaign_id,
    COALESCE(cr.booking_by, 'unknown') AS booking_by,
    cr.channel AS outreach_channel, cr.who_by, cr.who_sure, cr.where_rung, cr.where_sure,
    cr.person AS credit_person, cr.reason AS credit_reason
  FROM dash_meetings dm
  LEFT JOIN dash_company_domains cd ON cd.domain = dm.company_domain
  LEFT JOIN dash_meeting_credit cr ON cr.meeting_id = dm.id
  LEFT JOIN dash_internal_domains idom ON idom.domain = COALESCE(cr.company_domain, cd.canonical_domain, dm.company_domain)
  LEFT JOIN LATERAL (
    SELECT f.booked_on
      FROM dash_sdr_form f
     WHERE f.company_domain = COALESCE(cr.company_domain, cd.canonical_domain, dm.company_domain)
       AND f.meeting_date BETWEEN dm.meeting_date - 14 AND dm.meeting_date + 14
     ORDER BY (f.sdr IS NOT NULL) DESC, abs(f.meeting_date - dm.meeting_date)
     LIMIT 1
  ) form ON TRUE
)
SELECT
  m.*,
  -- One definition of what outreach may claim, which every page reads (OUTREACH_MEETING):
  --   sourced  an SDR booked it (booking_by 'sdr'), or AI SDR did
  --   none     anyone else did, or nothing says who
  CASE WHEN m.booking_by = 'sdr' THEN 'sourced' ELSE 'none' END AS attribution,
  -- Campaign, SDR and program name an SDR's meeting only. The campaign is the outreach it
  -- came from, never a broadcast, and can be none: a call, a referral, Piyush's own LinkedIn.
  CASE WHEN m.booking_by = 'sdr' THEN oc.id END      AS campaign_id,
  CASE WHEN m.booking_by = 'sdr' THEN oc.name END    AS campaign_name,
  CASE WHEN m.booking_by = 'sdr' THEN oc.sdr END     AS campaign_sdr,
  CASE WHEN m.booking_by = 'sdr' THEN oc.program END AS program,
  CASE WHEN m.booking_by = 'sdr' THEN oc.theme END   AS theme,
  CASE WHEN m.booking_by = 'sdr' THEN s.sdr END      AS attributed_sdr,
  s.share::float                                     AS share,
  -- m.* already carries outcome, evidence_source and evidence_note, written by the
  -- meetings-evidence job (011) from a waterfall of evidence. Held means the prospect
  -- turned up, which something has to back. Until that job has first run, the audit
  -- sheet's own column stands in.
  (COALESCE(m.outcome, CASE WHEN lower(m.happened) = 'yes' THEN 'held' END) = 'held') AS did_happen,
  -- A booking that moved keeps its row so the move is visible, but the meeting
  -- is counted once, at the slot it moved to.
  (m.superseded_by IS NOT NULL) AS rescheduled
FROM m
LEFT JOIN dash_v_campaigns oc ON oc.id = m.credit_campaign_id AND NOT oc.excluded
CROSS JOIN LATERAL (
  SELECT u.sdr, u.share FROM unnest(m.sdrs, m.shares) AS u(sdr, share)
  UNION ALL
  SELECT NULL, 1 WHERE cardinality(COALESCE(m.sdrs, '{}')) = 0
) s
WHERE NOT m.internal AND m.merged_into IS NULL;
