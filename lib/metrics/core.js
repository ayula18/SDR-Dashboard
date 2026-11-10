/**
 * The building blocks every page is made of. Each takes the dashboard filters
 * and a range ({ grain, periods, from, toExclusive }), and optionally a SQL
 * expression to group by (returned as `key`).
 *
 * Where each number comes from:
 *   sent, leads contacted, bounces   platform analytics per week/month (dash_campaign_periods).
 *                                    `sent` is FIRST emails only, Instantly's new leads
 *                                    contacted (Ayush, 2026-11-04); `allSent` has the
 *                                    follow-ups too, and is what the channel cards call
 *                                    "Total emails" (2026-11-05) and the bounce rate divides by
 *   people emailed                   leads, each person once, at their first email (peopleEmailed)
 *   LinkedIn messages                the first message to each person (025), never HeyReach's
 *                                    counter, which counts every follow-up
 *   replies, negative                leads, each dated by the day it landed (OUTCOME_AT in sql.js)
 *   positive                         SDR campaigns: the positive response sheet, on the day it logs.
 *                                    Everything else: our reply labels, on the day the reply landed
 *   leads/accounts loaded            leads, dated by when they were loaded
 *   meetings                         the meetings audit sheet, dated by meeting date
 *   LinkedIn                         HeyReach campaign stats; without them, the AI SDR archive
 */

import { qp } from '../db.js';
import { MEETINGS, MEETING_CHANNEL_OF_PLATFORM, Params, bucket, scope, sheetOutcomes } from './sql.js';
export { OUTCOME_AT } from './sql.js';

const keyColumn = groupBy => (groupBy ? `${groupBy} AS key,` : '');
const groupClause = groupBy => (groupBy ? 'GROUP BY 1' : '');
const result = (groupBy, rows) => (groupBy ? rows : rows[0]);

export async function emailActivity(filters, range, groupBy = null) {
  const p = new Params();
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           COALESCE(SUM(a.new_leads_contacted), 0)::int AS sent,
           COALESCE(SUM(a.sent), 0)::int                AS "allSent",
           COALESCE(SUM(a.new_leads_contacted), 0)::int AS "leadsContacted",
           COALESCE(SUM(a.replies_unique), 0)::int      AS "platformReplies",
           COALESCE(SUM(a.auto_replies_unique), 0)::int AS "autoReplies",
           COALESCE(SUM(a.bounced), 0)::int             AS bounced,
           COALESCE(SUM(a.unsubscribed), 0)::int        AS unsubscribed,
           COALESCE(SUM(a.opportunities), 0)::int       AS opportunities,
           COUNT(DISTINCT a.campaign_id)::int           AS "activeCampaigns"
      FROM dash_campaign_periods a
      JOIN dash_v_campaigns c ON c.id = a.campaign_id
     WHERE c.platform = 'instantly'
       AND a.grain = ${p.add(range.grain)}
       AND a.period_start = ANY(${p.add(range.periods)}::date[])
       AND ${scope('campaign', 'c', filters, p)}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

/**
 * People who got a first email in the range, each counted once however many
 * campaigns emailed them: dash_v_leads.first_contact_at is the lead's first send.
 */
export async function peopleEmailed(filters, range, groupBy = null) {
  const p = new Params();
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           count(DISTINCT lower(l.email))::int AS people
      FROM dash_v_leads l
     WHERE l.first_contact_at >= ${p.add(range.from)} AND l.first_contact_at < ${p.add(range.toExclusive)}
       AND ${scope('lead', 'l', filters, p)}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

/**
 * Invites from HeyReach's period stats (one per person, so already a first
 * touch) and messages as the FIRST message to each person (025): HeyReach's own
 * message counter counts every follow-up. `groupBy` is SQL over a (period_start)
 * and c (the campaign), as for email.
 */
export async function linkedinActivity(filters, range, groupBy = null) {
  const p = new Params();
  const m = new Params();
  const [stats, firsts] = await Promise.all([
    qp(`
      SELECT ${keyColumn(groupBy)}
             COALESCE(SUM(a.connections_sent), 0)::int     AS "invitesSent",
             COALESCE(SUM(a.connections_accepted), 0)::int AS "invitesAccepted",
             COALESCE(SUM(a.message_replies), 0)::int      AS replies,
             COUNT(DISTINCT a.campaign_id)::int            AS "activeCampaigns"
        FROM dash_campaign_periods a
        JOIN dash_v_campaigns c ON c.id = a.campaign_id
       WHERE c.platform = 'heyreach'
         AND a.grain = ${p.add(range.grain)}
         AND a.period_start = ANY(${p.add(range.periods)}::date[])
         AND ${scope('campaign', 'c', filters, p)}
       ${groupClause(groupBy)}`, p.values),
    qp(`
      SELECT ${keyColumn(groupBy)}
             count(*)::int AS "messagesSent"
        FROM (SELECT campaign_id, date_trunc(${m.add(range.grain)}, first_message_at)::date AS period_start
                FROM dash_linkedin_leads
               WHERE first_message_at >= ${m.add(range.from)} AND first_message_at < ${m.add(range.toExclusive)}) a
        JOIN dash_v_campaigns c ON c.id = a.campaign_id
       WHERE ${scope('campaign', 'c', filters, m)}
       ${groupClause(groupBy)}`, m.values),
  ]);
  const zero = { invitesSent: 0, invitesAccepted: 0, messagesSent: 0, replies: 0, activeCampaigns: 0 };
  if (!groupBy) return { ...zero, ...stats[0], messagesSent: firsts[0].messagesSent };
  const merged = new Map();
  for (const r of [...stats, ...firsts]) merged.set(r.key, { ...zero, ...(merged.get(r.key) || {}), ...r });
  return [...merged.values()];
}

/**
 * LinkedIn activity as archived by the AI SDR app from HeyReach conversations.
 * It carries sender accounts but no campaign, so it can't be split by SDR or
 * program. `by`: null | 'sender' | 'period' (with `grain`).
 */
export async function linkedinArchive(range, { by = null, grain = null } = {}) {
  const sentKey = by === 'sender' ? `COALESCE(e.owner_name, 'Unknown')` : by === 'period' ? bucket(grain, 'e.first_at') : null;
  const replyKey = by === 'sender' ? `COALESCE(t.sender, 'Unknown')` : by === 'period' ? bucket(grain, 't.last_reply_at') : null;

  const [sent, replies] = await Promise.all([
    qp(`
      -- First messages only, as everywhere else: each person counts once, at the
      -- first message anyone sent them, credited to the account that sent it.
      SELECT ${keyColumn(sentKey)}
             count(*)::int AS "messagesSent",
             count(*)::int AS conversations
        FROM (
          SELECT DISTINCT ON (raw->'profile'->>'linkedinId') owner_name, occurred_at AS first_at
            FROM ctx_events
           WHERE source = 'heyreach' AND event_type = 'linkedin_message' AND direction = 'outbound'
             AND raw->'profile'->>'linkedinId' IS NOT NULL
           ORDER BY raw->'profile'->>'linkedinId', occurred_at
        ) e
       WHERE e.first_at >= $1 AND e.first_at < $2
       ${groupClause(sentKey)}`, [range.from, range.toExclusive]),
    qp(`
      -- As everywhere: someone an SDR's campaign reached is positive if the sheet
      -- says so, and everyone else if a reply was labelled so.
      WITH sheet AS (
        SELECT DISTINCT linkedin_id FROM dash_v_sheet_positives WHERE channel = 'linkedin' AND linkedin_id IS NOT NULL
      ),
      sdr_reached AS (
        SELECT DISTINCT l.linkedin_id
          FROM dash_linkedin_leads l
          JOIN dash_v_campaigns c ON c.id = l.campaign_id
         WHERE c.positives_from_sheet AND l.linkedin_id IS NOT NULL
      ),
      t AS (
        SELECT split_part(v.id, ':', 2) AS thread, max(v.sender) AS sender, max(v.replied_at) AS last_reply_at,
               bool_or(s.linkedin_id IS NOT NULL OR (r.linkedin_id IS NULL AND v.is_positive)) AS positive,
               bool_or(s.linkedin_id IS NULL AND v.is_negative) AS negative,
               bool_and(v.is_auto) AS auto
          FROM dash_v_reply_verdicts v
          LEFT JOIN sheet s ON s.linkedin_id = v.person_linkedin_id
          LEFT JOIN sdr_reached r ON r.linkedin_id = v.person_linkedin_id
         WHERE v.platform = 'linkedin'
         GROUP BY 1
      )
      SELECT ${keyColumn(replyKey)}
             count(*) FILTER (WHERE NOT t.auto)::int                    AS replies,
             count(*) FILTER (WHERE t.positive)::int                  AS positive,
             count(*) FILTER (WHERE t.negative)::int                  AS negative
        FROM t
       WHERE t.last_reply_at >= $1 AND t.last_reply_at < $2
       ${groupClause(replyKey)}`, [range.from, range.toExclusive]),
  ]);

  if (!by) return { messagesSent: 0, conversations: 0, replies: 0, positive: 0, negative: 0, ...sent[0], ...replies[0] };

  const merged = new Map();
  for (const r of [...sent, ...replies]) merged.set(r.key, { ...(merged.get(r.key) || {}), ...r });
  return [...merged.values()].map(r => ({ messagesSent: 0, conversations: 0, replies: 0, positive: 0, negative: 0, ...r }));
}

/**
 * Email outcomes that landed in [from, to), one row per outcome ('replied' |
 * 'positive' | 'negative') with its date in outcome_at. Takes bind placeholders.
 * Alias the result `l`; it carries the columns listed here and nothing else.
 *
 * Each PERSON counts once per outcome, at the earliest date across all their
 * campaigns, credited to that campaign, and only then is the range applied.
 * Filtering first let someone in two campaigns reply in week 1 and again in
 * week 3 and count in both weeks, so the weeks of a month added up to more
 * than the month. Excluded campaigns are dropped before choosing.
 *
 * A positive on the sheet is the sheet's, not the lead's (sheetOutcomes), so it
 * keeps the SDR the sheet credits and includes rows with no lead at all. on_sheet
 * keeps a lead's label from counting the same person a second time.
 */
export const emailOutcomeEvents = (from, to) => `(
    SELECT * FROM (
      (SELECT DISTINCT ON (lower(l0.email), e.kind)
              l0.campaign_id, l0.company_domain, l0.sdr, l0.program, l0.theme, l0.excluded, l0.replied_step, l0.email,
              e.kind, e.at AS outcome_at
        FROM dash_v_leads l0
       CROSS JOIN LATERAL (VALUES ('replied', l0.first_reply_at, l0.replied),
                                  ('positive', l0.positive_at, l0.positive AND NOT l0.on_sheet),
                                  ('negative', l0.negative_at, l0.negative)) AS e(kind, at, hit)
       WHERE e.hit AND e.at IS NOT NULL AND NOT l0.excluded
       ORDER BY lower(l0.email), e.kind, e.at)
      UNION ALL${sheetOutcomes('email', `s.campaign_id, s.company_domain, s.sdr, s.program, s.theme, FALSE, s.replied_step, s.key`)}
    ) once
    WHERE once.outcome_at >= ${from} AND once.outcome_at < ${to})`;

/** Email replies, positives and said-no that landed in the range, each counted once (OUTCOME_AT). */
export async function leadOutcomes(filters, range, groupBy = null) {
  const p = new Params();
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           count(*) FILTER (WHERE l.kind = 'replied')::int                        AS replied,
           count(*) FILTER (WHERE l.kind = 'positive')::int                       AS positive,
           count(*) FILTER (WHERE l.kind = 'negative')::int                       AS negative,
           count(DISTINCT l.company_domain) FILTER (WHERE l.kind = 'replied')::int  AS "repliedAccounts",
           count(DISTINCT l.company_domain) FILTER (WHERE l.kind = 'positive')::int AS "positiveAccounts"
      FROM ${emailOutcomeEvents(p.add(range.from), p.add(range.toExclusive))} l
     WHERE ${scope('lead', 'l', filters, p)}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

export async function allocation(filters, range, groupBy = null) {
  const p = new Params();
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           count(*)::int                                                  AS "leadsLoaded",
           count(DISTINCT l.company_domain)::int                          AS "accountsLoaded",
           count(*) FILTER (WHERE l.contacted)::int                       AS "leadsContacted",
           count(DISTINCT l.company_domain) FILTER (WHERE l.contacted)::int AS "accountsContacted"
      FROM dash_v_leads l
     WHERE l.created_at_src >= ${p.add(range.from)} AND l.created_at_src < ${p.add(range.toExclusive)}
       AND ${scope('lead', 'l', filters, p)}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

/**
 * Meetings SDR outreach booked (OUTREACH_MEETING, via scope), summed by share.
 * `platform` keeps only the meetings whose outreach was on that channel (the
 * credit's, which a call or a chat on Piyush's own LinkedIn has without a
 * campaign), which is how an email/LinkedIn view narrows them.
 */
export async function meetingTotals(filters, range, groupBy = null, { channel = null, platform = null } = {}) {
  const p = new Params();
  const where = [
    `m.meeting_date >= ${p.add(range.from)}`,
    `m.meeting_date < ${p.add(range.toExclusive)}`,
    scope('meeting', 'm', filters, p),
  ];

  if (channel) where.push(`m.channel = ${p.add(channel)}`);
  if (platform) where.push(`m.outreach_channel = ${p.add(MEETING_CHANNEL_OF_PLATFORM[platform] || platform)}`);

  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           -- A booking that moved is counted once, at the slot it moved to, so every
           -- total here leaves the superseded slot out and counts it under rescheduled.
           ${MEETINGS('m', 'NOT m.rescheduled')}                  AS meetings,
           ${MEETINGS('m', 'm.did_happen')}                       AS held,
           ${MEETINGS('m', "m.outcome = 'no_show'")}              AS "noShow",
           ${MEETINGS('m', "m.outcome = 'review'")}               AS "pendingReview",
           ${MEETINGS('m', "m.outcome = 'upcoming'")}             AS upcoming,
           ${MEETINGS('m', 'm.rescheduled')}                      AS rescheduled,
           ${MEETINGS('m', "lower(m.senior_champion) = 'yes' AND NOT m.rescheduled")} AS "seniorChampion"
      FROM dash_v_meetings m
     WHERE ${where.join(' AND ')}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

/** Everything loaded (optionally since a date) and what became of it: the program/campaign funnel. */
export async function lifetimeLeads(filters, { since = null, groupBy = null } = {}) {
  const p = new Params();
  const where = [scope('lead', 'l', filters, p)];
  if (since) where.push(`l.created_at_src >= ${p.add(since)}`);
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           count(*)::int                                                    AS "leadsLoaded",
           count(DISTINCT l.company_domain)::int                            AS "accountsLoaded",
           count(*) FILTER (WHERE l.contacted)::int                         AS "leadsContacted",
           count(DISTINCT l.company_domain) FILTER (WHERE l.contacted)::int AS "accountsContacted",
           count(*) FILTER (WHERE l.replied)::int                           AS replied,
           count(DISTINCT l.company_domain) FILTER (WHERE l.replied)::int   AS "accountsReplied",
           count(*) FILTER (WHERE l.positive)::int                          AS positive,
           count(DISTINCT l.company_domain) FILTER (WHERE l.positive)::int  AS "accountsPositive",
           count(*) FILTER (WHERE l.negative)::int                          AS negative,
           count(DISTINCT l.campaign_id)::int                               AS campaigns
      FROM dash_v_leads l
     WHERE ${where.join(' AND ')}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

export async function lifetimeMeetings(filters, { since = null, groupBy = null } = {}) {
  const p = new Params();
  const where = ['m.campaign_id IS NOT NULL', 'NOT m.rescheduled', scope('meeting', 'm', filters, p)];
  if (since) where.push(`m.meeting_date >= ${p.add(since)}`);
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           ${MEETINGS('m')}                                                 AS meetings,
           count(DISTINCT m.company_domain)::int                            AS "accountsWithMeeting",
           ${MEETINGS('m', 'm.did_happen')}                                 AS held
      FROM dash_v_meetings m
     WHERE ${where.join(' AND ')}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

/** Platform lifetime totals for campaigns created since `since`. */
export async function lifetimePlatform(filters, { since = null, groupBy = null } = {}) {
  const p = new Params();
  const where = [scope('campaign', 'c', filters, p)];
  if (since) where.push(`c.created_at_src >= ${p.add(since)}`);
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           COALESCE(SUM(s.new_leads_contacted), 0)::int  AS "emailsSent",
           COALESCE(SUM(s.sent), 0)::int                 AS "allEmailsSent",
           COALESCE(SUM(s.new_leads_contacted), 0)::int  AS "leadsContacted",
           COALESCE(SUM(s.replies_unique), 0)::int       AS "platformReplies",
           COALESCE(SUM(s.auto_replies_unique), 0)::int  AS "autoReplies",
           COALESCE(SUM(s.bounced), 0)::int              AS bounced,
           COALESCE(SUM(s.opportunities), 0)::int        AS opportunities,
           COALESCE(SUM(s.connections_sent), 0)::int     AS "linkedinInvitesSent",
           COALESCE(SUM(s.connections_accepted), 0)::int AS "linkedinInvitesAccepted",
           COALESCE(SUM(fm.first_messages), 0)::int      AS "linkedinMessagesSent",
           COALESCE(SUM(s.message_replies), 0)::int      AS "linkedinReplies"
      FROM dash_campaign_stats s
      JOIN dash_v_campaigns c ON c.id = s.campaign_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS first_messages FROM dash_linkedin_leads ll
         WHERE ll.campaign_id = c.id AND ll.first_message_at IS NOT NULL
      ) fm ON TRUE
     WHERE ${where.join(' AND ')}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

/**
 * Most recent classified replies for the filtered campaigns, on both channels.
 * A LinkedIn reply belongs to the latest campaign that added its writer before
 * it came in, as in dash_v_linkedin_leads. `companyKey` is the company as
 * companiesAcrossChannels keys it (the lead's domain, or a LinkedIn company with
 * admin mappings applied), so a reply can open that company's conversation.
 * Options: from/toExclusive bound the reply date; channel is both | email | linkedin.
 */
export async function recentReplies(filters, { limit = 30, from = null, toExclusive = null, channel = 'both' } = {}) {
  const p = new Params();
  const dates = () => [from && ` AND v.replied_at >= ${p.add(from)}`, toExclusive && ` AND v.replied_at < ${p.add(toExclusive)}`]
    .filter(Boolean).join('');
  const parts = [];
  if (channel !== 'linkedin') {
    parts.push(`
      SELECT v.replied_at AS "repliedAt", v.platform, v.verdict, v.is_negative AS negative, v.is_auto AS auto,
             v.quote, v.reason, v.classifier, COALESCE(dl.company_domain, v.company_domain) AS domain,
             COALESCE(dl.company_domain, v.company_domain) AS "companyKey", v.person_name AS name, c.name AS campaign, c.sdr
        FROM dash_v_reply_verdicts v
        JOIN dash_v_campaigns c ON c.external_id = v.campaign_external_id AND c.platform = 'instantly'
        LEFT JOIN dash_v_leads dl ON dl.campaign_id = c.id AND dl.email = v.person_email
       WHERE v.platform = 'email' AND ${scope('campaign', 'c', filters, p)} AND NOT v.is_auto${dates()}`);
  }
  if (channel !== 'email') {
    parts.push(`
      SELECT v.replied_at AS "repliedAt", v.platform, v.verdict, v.is_negative AS negative, v.is_auto AS auto,
             v.quote, v.reason, v.classifier, COALESCE(a.domain, v.company_domain) AS domain, a.company AS "companyKey",
             v.person_name AS name, c.name AS campaign, c.sdr
        FROM dash_v_reply_verdicts v
        JOIN LATERAL (
          -- The view, not the raw table: it has already applied the admin alias,
          -- the canonical domain and the page/name closure, so a reply lands on
          -- exactly the company key the lists elsewhere group by. Rebuilding that
          -- here is what let the same company answer to two different keys.
          SELECT l.campaign_id, l.company_domain AS domain,
                 CASE WHEN l.no_company THEN NULL ELSE l.company_id END AS company
            FROM dash_v_linkedin_leads l
           WHERE l.linkedin_id = v.person_linkedin_id AND l.added_at <= v.replied_at
           ORDER BY l.added_at DESC
           LIMIT 1
        ) a ON TRUE
        JOIN dash_v_campaigns c ON c.id = a.campaign_id
       WHERE v.platform = 'linkedin' AND ${scope('campaign', 'c', filters, p)} AND NOT v.is_auto${dates()}`);
  }
  if (!parts.length) return [];
  return qp(`
    SELECT * FROM (${parts.join('\n      UNION ALL')}
    ) replies
    ORDER BY "repliedAt" DESC NULLS LAST
    LIMIT ${p.add(limit)}`, p.values);
}
