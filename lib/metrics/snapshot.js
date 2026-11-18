import { qp } from '../db.js';
import { emailOutcomeEvents } from './core.js';
import { describeRange } from './filters.js';
import { roster, shownSdrs } from './funnel.js';
import { linkedinOutcomeEvents } from './linkedin.js';
import { listMeetings } from './meetings.js';
import { OUTCOME_AT, Params, scope } from './sql.js';

/**
 * Snapshot View (Ayush, 2026-11-17: the 13 Nov SDR weekly report's format without LinkedIn
 * messages, with calls, meetings last; then "we dont need segment vise data here so remove
 * the segment column. and remove cals connected column too"): for each SDR and caller, what
 * went out in the dates and what came back, results split by whether the outreach behind
 * them began in the dates or before.
 *
 * Every number is the one the other pages count:
 *   emails         first emails, a person at a time (dash_v_leads.first_contact_at, which
 *                  matches Instantly's new leads contacted to the person: 695 = 695, 9-13 Nov)
 *   invites        HeyReach's own count (dash_campaign_periods), as linkedinActivity reads it
 *   calls          each call on Nooks; conversations are connected calls of 60+ seconds
 *   positives      emailOutcomeEvents, linkedinOutcomeEvents and callOutcomes' sources
 *   meetings       listMeetings, on the day each was booked (booked_on)
 */

export const METRICS = ['emails', 'invites', 'callsMade', 'conversations', 'positiveNew', 'positiveOld', 'meetingsNew', 'meetingsOld'];
const zero = () => Object.fromEntries(METRICS.map(k => [k, 0]));

/**
 * Whether a positive or meeting came from outreach that began in the dates (Ayush's
 * "current week's outreach") or before them ("old outreach"): the credited person's first
 * email or LinkedIn touch at that company. A call is one touch, so a call's result is the
 * dates' own unless that company was emailed or invited before them. Without a first touch
 * to show for an email or LinkedIn result, it is old: new is claimed only where we see it.
 */
export function isNewOutreach({ channel, firstTouch, from }) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const at = firstTouch ? new Date(firstTouch).getTime() : null;
  if (channel === 'call') return at == null || at >= start;
  return at != null && at >= start;
}

/**
 * The table from the rows the queries returned: a row per person, then everyone together.
 * Pure, so a test can hold it to the rules above.
 */
export function buildSnapshot({ people, emails = [], invites = [], calls = [], positives = [], meetings = [], firstTouch = new Map(), from }) {
  const cells = new Map(people.map(p => [p, zero()]));
  const add = (sdr, key, n) => { if (cells.has(sdr)) cells.get(sdr)[key] += Number(n) || 0; };

  for (const r of emails) add(r.sdr, 'emails', r.n);
  for (const r of invites) add(r.sdr, 'invites', r.n);
  for (const r of calls) {
    add(r.sdr, 'callsMade', r.made);
    add(r.sdr, 'conversations', r.conversations);
  }
  const fresh = (r, channel) => isNewOutreach({ channel, firstTouch: firstTouch.get(`${r.sdr}|${r.domain}`), from });
  for (const r of positives) add(r.sdr, fresh(r, r.channel) ? 'positiveNew' : 'positiveOld', r.n);
  for (const m of meetings) add(m.sdr, fresh(m, m.outreachChannel) ? 'meetingsNew' : 'meetingsOld', m.share ?? 1);

  const total = zero();
  for (const p of people) for (const k of METRICS) total[k] += cells.get(p)[k];
  return [
    ...people.map(p => ({ person: p, ...cells.get(p) })),
    { person: `All ${people.length}`, total: true, ...total },
  ];
}

/** The snapshot for the dates and people the filters pick (the SDRs and the callers, until someone is picked). */
export async function getSnapshot(filters) {
  const range = { from: filters.from, toExclusive: filters.toExclusive };
  const q = async (build) => {
    const p = new Params();
    const sql = build(p);
    return qp(sql, p.values);
  };

  const [team, emails, invites, calls, emailPositives, linkedinPositives, callPositives, meetings] = await Promise.all([
    roster(),
    q(p => `
      SELECT l.sdr, count(*)::int AS n
        FROM dash_v_leads l
       WHERE l.first_contact_at >= ${p.add(range.from)} AND l.first_contact_at < ${p.add(range.toExclusive)}
         AND ${scope('lead', 'l', filters, p)}
       GROUP BY 1`),
    q(p => `
      SELECT c.sdr, COALESCE(sum(a.connections_sent), 0)::int AS n
        FROM dash_campaign_periods a JOIN dash_v_campaigns c ON c.id = a.campaign_id
       WHERE a.grain = 'day' AND c.platform = 'heyreach'
         AND a.period_start >= ${p.add(range.from)} AND a.period_start < ${p.add(range.toExclusive)}
         AND ${scope('campaign', 'c', filters, p)}
       GROUP BY 1`),
    q(p => `
      SELECT c.sdr, count(*)::int AS made, count(*) FILTER (WHERE c.conversation)::int AS conversations
        FROM dash_v_calls c
       WHERE c.called_at >= ${p.add(range.from)} AND c.called_at < ${p.add(range.toExclusive)} AND ${scope('call', 'c', filters, p)}
       GROUP BY 1`),
    q(p => `
      SELECT l.sdr, l.company_domain AS domain, 'email' AS channel, count(*)::int AS n
        FROM ${emailOutcomeEvents(p.add(range.from), p.add(range.toExclusive))} l
       WHERE l.kind = 'positive' AND ${scope('lead', 'l', filters, p)}
       GROUP BY 1, 2`),
    q(p => `
      SELECT l.sdr, l.company_domain AS domain, 'linkedin' AS channel, count(DISTINCT l.linkedin_id)::int AS n
        FROM ${linkedinOutcomeEvents(p.add(range.from), p.add(range.toExclusive))} l
       WHERE l.kind = 'positive' AND ${scope('linkedin', 'l', filters, p)}
       GROUP BY 1, 2`),
    // callOutcomes' two sources, as it counts them.
    q(p => `
      SELECT l.sdr, l.company_domain AS domain, 'call' AS channel, count(*)::int AS n
        FROM (SELECT s.sdr, s.program, s.theme, s.campaign_id, s.company_domain, s.replied_at AS outcome_at
                FROM dash_v_sheet_positives s WHERE s.channel = 'call'
              UNION ALL
              SELECT c.sdr, c.program, c.theme, c.campaign_id, NULL::text, c.called_at
                FROM dash_v_calls c WHERE c.positive) l
       WHERE ${OUTCOME_AT} >= ${p.add(range.from)} AND ${OUTCOME_AT} < ${p.add(range.toExclusive)}
         AND ${scope('sheet', 'l', filters, p)}
       GROUP BY 1, 2`),
    listMeetings(filters, { from: range.from, toExclusive: range.toExclusive, withRescheduled: false, limit: 3000 }),
  ]);

  const positives = [...emailPositives, ...linkedinPositives, ...callPositives];
  const resultDomains = [...new Set([...positives, ...meetings].map(r => r.domain).filter(Boolean))];
  const firstTouches = resultDomains.length ? await qp(`
    SELECT sdr, domain, min(at) AS at FROM (
      SELECT l.sdr, l.company_domain AS domain, min(l.first_contact_at) AS at
        FROM dash_v_leads l WHERE NOT l.excluded AND l.company_domain = ANY($1::text[]) GROUP BY 1, 2
      UNION ALL
      SELECT l.sdr, l.company_domain, min(l.first_touch_at)
        FROM dash_v_linkedin_leads l WHERE NOT l.excluded AND l.reached AND l.company_domain = ANY($1::text[]) GROUP BY 1, 2
    ) x GROUP BY 1, 2`, [resultDomains]) : [];

  // The SDRs, then the callers, as the roster orders them; or exactly who was picked.
  const shown = shownSdrs(team, filters.sdr, { channel: 'all' });
  const people = [...shown.filter(t => t.role !== 'caller'), ...shown.filter(t => t.role === 'caller')].map(t => t.name);
  return {
    range: describeRange(filters),
    people,
    rows: buildSnapshot({
      people,
      emails,
      invites,
      calls,
      positives,
      meetings,
      firstTouch: new Map(firstTouches.map(r => [`${r.sdr}|${r.domain}`, r.at])),
      from: range.from,
    }),
  };
}
