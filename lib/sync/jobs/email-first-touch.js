import { qp } from '../../db.js';
import { INSTANTLY_SOURCES } from '../../outreach/email-sources.js';

/** Sends this recent are re-checked each run; older ones only in full mode. */
const WINDOW_DAYS = 10;

/**
 * When each email lead got its FIRST email, from the archive (022).
 *
 * Instantly's lead object carries only the last contact, so on its own this
 * app could only say when a lead was last emailed — and counting companies by
 * that moved a company out of the week it was first reached every time a
 * follow-up went out. The AI SDR app archives every send in ctx_events, so the
 * first one is simply the earliest of them for that person in that campaign.
 *
 * No API call and no message content: one aggregate over the archive and an
 * UPDATE of dash_leads.first_contact_at, only ever moving it earlier. The
 * archive starts around May 2026; older leads keep their last-contact time,
 * which dash_v_leads falls back to.
 *
 * Incremental runs look at people sent to in the last WINDOW_DAYS (the archive
 * syncs daily, so that leaves a margin) and take the earliest send among ALL of
 * theirs. A send archived late for an older date is caught by --full.
 */
export const job = {
  label: 'First email to each lead, from the archive',
  dependsOn: ['instantly-leads'],
  weight: 1,
  minSliceMs: 10_000,
  maxAgeHours: 36,

  async run({ mode }) {
    const since = mode === 'full' ? null : new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const [{ updated }] = await qp(`
      WITH recent AS (
        SELECT DISTINCT campaign_id, lower(person_email) AS email
          FROM ctx_events
         WHERE source = ANY($1::text[]) AND event_type = 'email_sent'
           AND campaign_id IS NOT NULL AND person_email IS NOT NULL
           AND ($2::timestamptz IS NULL OR occurred_at >= $2)
      ),
      firsts AS (
        SELECT e.campaign_id, lower(e.person_email) AS email, min(e.occurred_at) AS first_at
          FROM ctx_events e
          JOIN recent r ON r.campaign_id = e.campaign_id AND r.email = lower(e.person_email)
         WHERE e.source = ANY($1::text[]) AND e.event_type = 'email_sent'
         GROUP BY 1, 2
      ),
      moved AS (
        UPDATE dash_leads l
           SET first_contact_at = f.first_at
          FROM firsts f
         WHERE l.campaign_id = 'instantly:' || f.campaign_id AND l.email = f.email
           AND (l.first_contact_at IS NULL OR l.first_contact_at > f.first_at)
        RETURNING 1
      )
      SELECT count(*)::int AS updated FROM moved`,
      [INSTANTLY_SOURCES, since]);

    return { updated, window: since ? `${WINDOW_DAYS} days` : 'all' };
  },
};
