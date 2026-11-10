import { qp } from '../db.js';
import { displayCompany } from './format.js';
import { Params, scope } from './sql.js';

/**
 * The positive responses behind a range, newest first, each with what the person
 * said. SDR rows come from the positive response sheet (Ayush, 2026-11-05), which
 * holds no reply text, so it is matched here from the archive: the reply from
 * that person closest to the logged day, within REPLY_WINDOW_DAYS. When we hold no
 * such reply the row still shows, with the SDR's own note. A booking nobody logged
 * shows the reply that led to it, or the meeting. Every other positive comes from our
 * reply labels and carries the labelled reply.
 *
 * Options: from/toExclusive bound the day; channel is both | email | linkedin | call.
 */
const REPLY_WINDOW_DAYS = 30;

export async function positiveResponses(filters, { from, toExclusive, channel = 'both', limit = 1000 } = {}) {
  const p = new Params();
  const start = p.add(from);
  const end = p.add(toExclusive);
  const parts = [`
      SELECT CASE WHEN s.tab = 'meeting' THEN 'booked' ELSE 'sheet' END AS source, s.channel, s.replied_at AS at, s.person_name AS name, s.company_name AS company,
             s.company_domain AS domain, s.company_domain AS "companyKey", s.sdr, s.campaign_name AS campaign,
             s.status, COALESCE(s.notes, s.comments) AS note, s.person_email, s.linkedin_id
        FROM dash_v_sheet_positives s
       WHERE s.replied_at >= ${start} AND s.replied_at < ${end} AND ${scope('sheet', 's', filters, p)}
         ${channel === 'both' ? '' : `AND s.channel = ${p.add(channel)}`}`];
  // The same pick as the outcome events: each person's earliest label across all
  // their campaigns, and only then the range and filters, so list and cards agree.
  // Calls have no reply labels: their positives are the sheet's waterfall only.
  if (channel === 'both' || channel === 'email') {
    parts.push(`
      SELECT 'labels' AS source, 'email' AS channel, l.positive_at AS at, l.email AS name, l.company_name AS company,
             l.company_domain AS domain, l.company_domain AS "companyKey", l.sdr, l.campaign_name AS campaign,
             NULL::text AS status, NULL::text AS note, lower(l.email) AS person_email, NULL::text AS linkedin_id
        FROM (
          SELECT DISTINCT ON (lower(l0.email)) l0.*
            FROM dash_v_leads l0
           WHERE l0.positive AND NOT l0.on_sheet AND NOT l0.excluded AND l0.positive_at IS NOT NULL
           ORDER BY lower(l0.email), l0.positive_at
        ) l
       WHERE l.positive_at >= ${start} AND l.positive_at < ${end} AND ${scope('lead', 'l', filters, p)}`);
  }
  if (channel === 'both' || channel === 'linkedin') {
    parts.push(`
      SELECT 'labels' AS source, 'linkedin' AS channel, l.positive_at AS at, l.person_name AS name, l.company_name AS company,
             l.company_domain AS domain, CASE WHEN l.no_company THEN NULL ELSE l.company_id END AS "companyKey",
             l.sdr, l.campaign_name AS campaign, NULL::text AS status, NULL::text AS note,
             NULL::text AS person_email, l.linkedin_id
        FROM (
          SELECT DISTINCT ON (l0.linkedin_id) l0.*
            FROM dash_v_linkedin_leads l0
           WHERE l0.positive AND NOT l0.on_sheet AND NOT l0.excluded AND l0.positive_at IS NOT NULL
           ORDER BY l0.linkedin_id, l0.positive_at
        ) l
       WHERE l.positive_at >= ${start} AND l.positive_at < ${end} AND ${scope('linkedin', 'l', filters, p)}`);
  }

  const rows = await qp(`
    WITH picked AS (
      SELECT * FROM (${parts.join('\n      UNION ALL')}
      ) positives
      ORDER BY at DESC, name
      LIMIT ${p.add(limit)}
    )
    SELECT picked.*, co.company_name AS matched_name, said.quote
      FROM picked
      LEFT JOIN companies co ON co.domain = picked.domain
      LEFT JOIN LATERAL (
        SELECT v.quote
          FROM dash_v_reply_verdicts v
         WHERE NOT v.is_auto AND v.quote IS NOT NULL
           AND ((picked.person_email IS NOT NULL AND lower(v.person_email) = picked.person_email)
             OR (picked.linkedin_id IS NOT NULL AND v.person_linkedin_id = picked.linkedin_id))
           AND v.replied_at >= picked.at - INTERVAL '${REPLY_WINDOW_DAYS} days'
           AND v.replied_at <  picked.at + INTERVAL '${REPLY_WINDOW_DAYS} days'
         ORDER BY v.is_positive DESC, abs(extract(epoch FROM v.replied_at - picked.at))
         LIMIT 1
      ) said ON TRUE
     ORDER BY picked.at DESC, picked.name`, p.values);

  return rows.map(r => ({
    source: r.source,
    channel: r.channel,
    at: r.at,
    name: r.name,
    company: displayCompany(r.matched_name, r.company, r.domain) || r.company || r.domain,
    domain: r.domain,
    companyKey: r.companyKey,
    sdr: r.sdr,
    campaign: r.campaign,
    status: r.status,
    note: r.note,
    quote: r.quote,
  }));
}

/** What the positive response sheet says about one company, for its conversation panel. */
export async function sheetRowsAtCompany(domain) {
  if (!domain) return [];
  return qp(`
    SELECT s.key, s.person_name AS name, s.channel, s.replied_at AS at, s.sdr, s.status, COALESCE(s.notes, s.comments) AS note
      FROM dash_v_sheet_positives s
     WHERE s.company_domain = $1 AND s.tab <> 'meeting'
     ORDER BY s.replied_on DESC`, [domain]);
}
