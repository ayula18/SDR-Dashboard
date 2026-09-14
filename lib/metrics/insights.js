import { qp } from '../db.js';
import { linkedinArchive } from './core.js';
import { describeRange } from './filters.js';
import { MIN_SAMPLE, markExtremes, rate } from './format.js';
import { COMPANY_TYPE, EMPLOYEE_BUCKET, Params, scope } from './sql.js';

/**
 * Leads loaded in the range, grouped, with how many were contacted, replied
 * and came back positive. Every lead in a group had the same chance to convert,
 * so rates compare fairly across SDRs, themes and segments. Replies that
 * haven't arrived yet make the most recent weeks look lower.
 */
export async function cohortBreakdown(filters, dims, { withCompanies = false } = {}) {
  const p = new Params();
  const names = Object.keys(dims);
  const rows = await qp(`
    SELECT ${names.map(n => `${dims[n]} AS "${n}"`).join(', ')},
           count(*)::int                                                   AS "leadsLoaded",
           count(DISTINCT l.company_domain)::int                           AS accounts,
           count(*) FILTER (WHERE l.contacted)::int                        AS contacted,
           count(*) FILTER (WHERE l.replied)::int                          AS replied,
           count(*) FILTER (WHERE l.positive)::int                         AS positive,
           count(*) FILTER (WHERE l.negative)::int                         AS negative,
           count(DISTINCT l.company_domain) FILTER (WHERE l.positive)::int AS "positiveAccounts"
      FROM dash_v_leads l
      ${withCompanies ? 'LEFT JOIN companies co ON co.domain = l.company_domain' : ''}
     WHERE l.created_at_src >= ${p.add(filters.from)} AND l.created_at_src < ${p.add(filters.toExclusive)}
       AND ${scope('lead', 'l', filters, p)}
     GROUP BY ${names.map((_, i) => i + 1).join(', ')}
     ORDER BY contacted DESC`, p.values);

  return rows.map(r => ({
    ...r,
    replyRate: rate(r.replied, r.contacted),
    positiveRate: rate(r.positive, r.contacted),
    lowSample: r.contacted < MIN_SAMPLE,
  }));
}

/** Which email in the sequence people answered, and how each step performs per send. */
export async function stepBreakdown(filters) {
  const replies = new Params();
  const sends = new Params();
  const [answered, sent] = await Promise.all([
    qp(`
      SELECT l.replied_step + 1 AS step,
             count(*) FILTER (WHERE l.replied)::int  AS replied,
             count(*) FILTER (WHERE l.positive)::int AS positive,
             count(*) FILTER (WHERE l.negative)::int AS negative
        FROM dash_v_leads l
       WHERE l.reply_count > 0 AND l.replied_step IS NOT NULL
         AND l.last_reply_at >= ${replies.add(filters.from)} AND l.last_reply_at < ${replies.add(filters.toExclusive)}
         AND ${scope('lead', 'l', filters, replies)}
       GROUP BY 1 ORDER BY 1`, replies.values),
    qp(`
      SELECT s.step + 1 AS step,
             SUM(s.sent)::int           AS sent,
             SUM(s.replies_unique)::int AS "platformReplies"
        FROM dash_campaign_steps s
        JOIN dash_v_campaigns c ON c.id = s.campaign_id
       WHERE ${scope('campaign', 'c', filters, sends)}
         AND EXISTS (SELECT 1 FROM dash_campaign_periods a
                      WHERE a.campaign_id = c.id AND a.grain = ${sends.add(filters.grain)}
                        AND a.period_start = ANY(${sends.add(filters.periods)}::date[]))
       GROUP BY 1 ORDER BY 1`, sends.values),
  ]);

  const byStep = new Map();
  for (const r of [...sent, ...answered]) byStep.set(r.step, { step: r.step, sent: 0, platformReplies: 0, replied: 0, positive: 0, negative: 0, ...byStep.get(r.step), ...r });
  const totalPositive = answered.reduce((s, r) => s + r.positive, 0);
  return [...byStep.values()]
    .sort((a, b) => a.step - b.step)
    .map(r => ({ ...r, stepReplyRate: rate(r.platformReplies, r.sent), shareOfPositive: rate(r.positive, totalPositive) }));
}

/** Best-performing step copy (subject + opening) among campaigns active in the range, lifetime numbers. */
export async function topCopy(filters, { limit = 20, minSent = 100 } = {}) {
  const p = new Params();
  return qp(`
    SELECT c.id AS "campaignId", c.name AS campaign, c.sdr, COALESCE(c.theme, 'Other') AS theme,
           s.step + 1 AS step, s.variant, s.subject, left(s.body_preview, 240) AS preview,
           s.sent, s.replies_unique AS replies,
           round(100.0 * s.replies_unique / NULLIF(s.sent, 0), 2)::float AS "replyRate"
      FROM dash_campaign_steps s
      JOIN dash_v_campaigns c ON c.id = s.campaign_id
     WHERE s.sent >= ${p.add(minSent)}
       AND ${scope('campaign', 'c', filters, p)}
       AND EXISTS (SELECT 1 FROM dash_campaign_periods a
                    WHERE a.campaign_id = c.id AND a.grain = ${p.add(filters.grain)}
                      AND a.period_start = ANY(${p.add(filters.periods)}::date[]))
     ORDER BY "replyRate" DESC NULLS LAST, s.sent DESC
     LIMIT ${p.add(limit)}`, p.values);
}

/** "What's working": conversion by SDR × theme, message angle, program, firmographics, step and copy. */
export async function getInsights(filters) {
  const [sdrTheme, byTheme, byProgram, bySdr, byCompanyType, byEmployees, byIcp, byCategory, steps, copy, linkedinSenders] = await Promise.all([
    cohortBreakdown(filters, { sdr: `COALESCE(l.sdr, 'Unattributed')`, theme: `COALESCE(l.theme, 'Other')` }),
    cohortBreakdown(filters, { theme: `COALESCE(l.theme, 'Other')` }),
    cohortBreakdown(filters, { program: `COALESCE(l.program, 'none')` }),
    cohortBreakdown(filters, { sdr: `COALESCE(l.sdr, 'Unattributed')` }),
    cohortBreakdown(filters, { companyType: COMPANY_TYPE }, { withCompanies: true }),
    cohortBreakdown(filters, { employees: EMPLOYEE_BUCKET }, { withCompanies: true }),
    cohortBreakdown(filters, { icp: `COALESCE(NULLIF(co.icp_decision, ''), 'Unknown')` }, { withCompanies: true }),
    cohortBreakdown(filters, { category: `COALESCE(NULLIF(co.category, ''), 'Unknown')` }, { withCompanies: true }),
    stepBreakdown(filters),
    topCopy(filters),
    linkedinArchive(filters, { by: 'sender' }),
  ]);

  const themeOrder = byTheme.map(t => t.theme);
  return {
    range: describeRange(filters),
    basis: 'Leads loaded in the selected range, with replies counted whenever they arrived. Rates are positive replies per contacted lead.',
    minSample: MIN_SAMPLE,
    sdrTheme: {
      sdrs: bySdr.map(s => s.sdr),
      themes: themeOrder,
      cells: markExtremes(sdrTheme),
    },
    byTheme: markExtremes(byTheme),
    byProgram: markExtremes(byProgram),
    bySdr: markExtremes(bySdr),
    byCompanyType: markExtremes(byCompanyType),
    byEmployees: markExtremes(byEmployees),
    byIcp: markExtremes(byIcp),
    byCategory: markExtremes(byCategory.slice(0, 15)),
    steps,
    topCopy: copy,
    linkedinBySender: linkedinSenders
      .map(s => ({ sender: s.key, ...s, replyRate: rate(s.replies, s.conversations), positiveRate: rate(s.positive, s.conversations) }))
      .sort((a, b) => b.messagesSent - a.messagesSent),
  };
}
