/**
 * The building blocks every page is made of. Each takes the dashboard filters
 * and a range ({ grain, periods, from, toExclusive }), and optionally a SQL
 * expression to group by (returned as `key`).
 *
 * Where each number comes from:
 *   sent, leads contacted, bounces   platform analytics per week/month (dash_campaign_periods)
 *   replies, positive, negative      leads, dated by their last reply (dash_v_leads)
 *   leads/accounts loaded            leads, dated by when they were loaded
 *   meetings                         the meetings audit sheet, dated by meeting date
 *   LinkedIn                         HeyReach campaign stats; without them, the AI SDR archive
 */

import { qp } from '../db.js';
import { Params, bucket, scope } from './sql.js';

const keyColumn = groupBy => (groupBy ? `${groupBy} AS key,` : '');
const groupClause = groupBy => (groupBy ? 'GROUP BY 1' : '');
const result = (groupBy, rows) => (groupBy ? rows : rows[0]);

export async function emailActivity(filters, range, groupBy = null) {
  const p = new Params();
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           COALESCE(SUM(a.sent), 0)::int                AS sent,
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

export async function linkedinActivity(filters, range, groupBy = null) {
  const p = new Params();
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           COALESCE(SUM(a.connections_sent), 0)::int     AS "invitesSent",
           COALESCE(SUM(a.connections_accepted), 0)::int AS "invitesAccepted",
           COALESCE(SUM(a.messages_sent), 0)::int        AS "messagesSent",
           COALESCE(SUM(a.message_replies), 0)::int      AS replies,
           COUNT(DISTINCT a.campaign_id)::int            AS "activeCampaigns"
      FROM dash_campaign_periods a
      JOIN dash_v_campaigns c ON c.id = a.campaign_id
     WHERE c.platform = 'heyreach'
       AND a.grain = ${p.add(range.grain)}
       AND a.period_start = ANY(${p.add(range.periods)}::date[])
       AND ${scope('campaign', 'c', filters, p)}
     ${groupClause(groupBy)}`, p.values);
  return result(groupBy, rows);
}

/**
 * LinkedIn activity as archived by the AI SDR app from HeyReach conversations.
 * It carries sender accounts but no campaign, so it can't be split by SDR or
 * program. `by`: null | 'sender' | 'period' (with `grain`).
 */
export async function linkedinArchive(range, { by = null, grain = null } = {}) {
  const sentKey = by === 'sender' ? `COALESCE(e.owner_name, 'Unknown')` : by === 'period' ? bucket(grain, 'e.occurred_at') : null;
  const replyKey = by === 'sender' ? `COALESCE(t.sender, 'Unknown')` : by === 'period' ? bucket(grain, 't.last_reply_at') : null;

  const [sent, replies] = await Promise.all([
    qp(`
      SELECT ${keyColumn(sentKey)}
             count(*)::int                   AS "messagesSent",
             count(DISTINCT e.thread_id)::int AS conversations
        FROM ctx_events e
       WHERE e.source = 'heyreach' AND e.event_type = 'linkedin_message'
         AND e.occurred_at >= $1 AND e.occurred_at < $2
       ${groupClause(sentKey)}`, [range.from, range.toExclusive]),
    qp(`
      WITH t AS (
        SELECT split_part(id, ':', 2) AS thread, max(sender) AS sender, max(replied_at) AS last_reply_at,
               bool_or(is_positive) AS positive, bool_or(is_negative) AS negative, bool_and(is_auto) AS auto
          FROM dash_v_reply_verdicts
         WHERE platform = 'linkedin'
         GROUP BY 1
      )
      SELECT ${keyColumn(replyKey)}
             count(*) FILTER (WHERE NOT t.auto)::int                    AS replies,
             count(*) FILTER (WHERE t.positive AND NOT t.negative)::int AS positive,
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

export async function leadOutcomes(filters, range, groupBy = null) {
  const p = new Params();
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           count(*) FILTER (WHERE l.replied)::int                        AS replied,
           count(*) FILTER (WHERE l.positive)::int                       AS positive,
           count(*) FILTER (WHERE l.negative)::int                       AS negative,
           count(DISTINCT l.company_domain) FILTER (WHERE l.replied)::int  AS "repliedAccounts",
           count(DISTINCT l.company_domain) FILTER (WHERE l.positive)::int AS "positiveAccounts"
      FROM dash_v_leads l
     WHERE l.reply_count > 0
       AND l.last_reply_at >= ${p.add(range.from)} AND l.last_reply_at < ${p.add(range.toExclusive)}
       AND ${scope('lead', 'l', filters, p)}
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

/** Meetings from the audit sheet. `outboundOnly` keeps outbound meetings plus any attributed to a campaign. */
export async function meetingTotals(filters, range, groupBy = null, { outboundOnly = false, channel = null } = {}) {
  const p = new Params();
  const where = [
    `m.meeting_date >= ${p.add(range.from)}`,
    `m.meeting_date < ${p.add(range.toExclusive)}`,
    scope('meeting', 'm', filters, p),
  ];
  if (outboundOnly) where.push(`(m.direction ILIKE 'outbound' OR m.campaign_id IS NOT NULL)`);
  if (channel) where.push(`m.channel = ${p.add(channel)}`);

  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           count(*)::int                                                              AS meetings,
           count(*) FILTER (WHERE m.did_happen)::int                                  AS held,
           count(*) FILTER (WHERE m.qualified)::int                                   AS qualified,
           count(*) FILTER (WHERE lower(m.happened) = 'no')::int                      AS "noShow",
           count(*) FILTER (WHERE m.happened IS NULL OR lower(m.happened) NOT IN ('yes', 'no'))::int AS "pendingReview",
           count(*) FILTER (WHERE lower(m.senior_champion) = 'yes')::int              AS "seniorChampion",
           COALESCE(SUM(m.deal_value) FILTER (WHERE m.qualified), 0)::float           AS "pipelineValue"
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
  const where = ['m.campaign_id IS NOT NULL', scope('meeting', 'm', filters, p)];
  if (since) where.push(`m.meeting_date >= ${p.add(since)}`);
  const rows = await qp(`
    SELECT ${keyColumn(groupBy)}
           count(*)::int                                                    AS meetings,
           count(DISTINCT m.company_domain)::int                            AS "accountsWithMeeting",
           count(*) FILTER (WHERE m.did_happen)::int                        AS held,
           count(*) FILTER (WHERE m.qualified)::int                         AS qualified,
           COALESCE(SUM(m.deal_value) FILTER (WHERE m.qualified), 0)::float AS "pipelineValue"
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
           COALESCE(SUM(s.sent), 0)::int                 AS "emailsSent",
           COALESCE(SUM(s.new_leads_contacted), 0)::int  AS "leadsContacted",
           COALESCE(SUM(s.replies_unique), 0)::int       AS "platformReplies",
           COALESCE(SUM(s.auto_replies_unique), 0)::int  AS "autoReplies",
           COALESCE(SUM(s.bounced), 0)::int              AS bounced,
           COALESCE(SUM(s.opportunities), 0)::int        AS opportunities,
           COALESCE(SUM(s.connections_sent), 0)::int     AS "linkedinInvitesSent",
           COALESCE(SUM(s.connections_accepted), 0)::int AS "linkedinInvitesAccepted",
           COALESCE(SUM(s.messages_sent), 0)::int        AS "linkedinMessagesSent",
           COALESCE(SUM(s.message_replies), 0)::int      AS "linkedinReplies"
      FROM dash_campaign_stats s
      JOIN dash_v_campaigns c ON c.id = s.campaign_id
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
        LEFT JOIN dash_leads dl ON dl.campaign_id = c.id AND dl.email = v.person_email
       WHERE v.platform = 'email' AND ${scope('campaign', 'c', filters, p)} AND NOT v.is_auto${dates()}`);
  }
  if (channel !== 'email') {
    parts.push(`
      SELECT v.replied_at AS "repliedAt", v.platform, v.verdict, v.is_negative AS negative, v.is_auto AS auto,
             v.quote, v.reason, v.classifier, COALESCE(a.domain, v.company_domain) AS domain, a.company AS "companyKey",
             v.person_name AS name, c.name AS campaign, c.sdr
        FROM dash_v_reply_verdicts v
        JOIN LATERAL (
          SELECT l.campaign_id,
                 CASE WHEN al.company_key IS NOT NULL THEN CASE WHEN al.not_a_company THEN NULL ELSE al.domain END
                      ELSE l.company_domain END AS domain,
                 CASE WHEN al.company_key IS NOT NULL THEN CASE WHEN al.not_a_company THEN NULL ELSE al.domain END
                      WHEN l.resolution = 'no_company' THEN NULL
                      ELSE COALESCE(l.company_domain, 'name:' || l.company_key) END AS company
            FROM dash_linkedin_leads l
            LEFT JOIN dash_company_aliases al ON al.company_key = l.company_key
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
