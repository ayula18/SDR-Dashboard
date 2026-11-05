import { qp } from '../../db.js';

/** Messages this recent are re-checked each run; older ones only in full mode. */
const WINDOW_DAYS = 10;

/**
 * When each LinkedIn person in a campaign got their FIRST message, from the archive (025).
 *
 * HeyReach's period stats count every message, follow-ups included, and its
 * person object carries only the latest action. The AI SDR app archives every
 * HeyReach conversation in ctx_events, so the first outbound message to a
 * person is the earliest of theirs. Each message belongs to the latest campaign
 * that added its person before it went out, the rule dash_v_linkedin_leads uses
 * for replies, so someone in two campaigns gets a first message in each.
 *
 * No API call and no message content: one aggregate over the archive and an
 * UPDATE of dash_linkedin_leads.first_message_at, only ever moving it earlier.
 *
 * heyreach-leads rewrites a campaign's rows whenever it re-reads the campaign,
 * which clears this column, so every run also refills anyone HeyReach says was
 * messaged who has no date yet, alongside people messaged in the last WINDOW_DAYS.
 */
export const job = {
  label: 'First LinkedIn message to each person, from the archive',
  dependsOn: ['heyreach-leads'],
  weight: 1,
  minSliceMs: 10_000,
  maxAgeHours: 36,

  async run({ mode }) {
    const since = mode === 'full' ? null : new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const [{ updated }] = await qp(`
      WITH sent AS (
        SELECT e.raw->'profile'->>'linkedinId' AS linkedin_id, e.occurred_at
          FROM ctx_events e
         WHERE e.source = 'heyreach' AND e.event_type = 'linkedin_message' AND e.direction = 'outbound'
           AND e.raw->'profile'->>'linkedinId' IS NOT NULL
      ),
      people AS (
        SELECT DISTINCT linkedin_id FROM sent WHERE $1::timestamptz IS NULL OR occurred_at >= $1
        UNION
        SELECT linkedin_id FROM dash_linkedin_leads
         WHERE first_message_at IS NULL AND message_status IN ('MessageSent', 'MessageReply')
      ),
      attributed AS (
        SELECT DISTINCT ON (s.linkedin_id, s.occurred_at) l.campaign_id, l.lead_id, s.occurred_at
          FROM sent s
          JOIN people p ON p.linkedin_id = s.linkedin_id
          JOIN dash_linkedin_leads l ON l.linkedin_id = s.linkedin_id AND l.added_at <= s.occurred_at
         ORDER BY s.linkedin_id, s.occurred_at, l.added_at DESC
      ),
      firsts AS (
        SELECT campaign_id, lead_id, min(occurred_at) AS first_at FROM attributed GROUP BY 1, 2
      ),
      moved AS (
        UPDATE dash_linkedin_leads l
           SET first_message_at = f.first_at
          FROM firsts f
         WHERE l.campaign_id = f.campaign_id AND l.lead_id = f.lead_id
           AND (l.first_message_at IS NULL OR l.first_message_at > f.first_at)
        RETURNING 1
      )
      SELECT count(*)::int AS updated FROM moved`,
      [since]);

    return { updated, window: since ? `${WINDOW_DAYS} days` : 'all' };
  },
};
