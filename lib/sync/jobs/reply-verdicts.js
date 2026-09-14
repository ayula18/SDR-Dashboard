import { qp, upsertRows } from '../../db.js';
import { domainFromEmail, normalizeDomain } from '../../outreach/domains.js';
import { VERDICT_COLUMNS, verdictRow } from '../verdicts.js';

const PAGE = 1000;

/**
 * Classifies the Instantly and HeyReach replies the AI SDR app has archived in
 * ctx_events. Keyset-paginated on (updated_at, id), with the timestamp kept as
 * text so microseconds survive the round trip, so re-synced events are picked
 * up again without re-reading everything.
 */
export const job = {
  label: 'Reply sentiment from the context archive',

  async run({ mode, cursor: saved, saveCursor, deadline }) {
    let after = mode === 'full' ? null : saved;
    let classified = 0;

    for (;;) {
      const events = await qp(
        `SELECT id, source, source_event_id, occurred_at, updated_at::text AS updated_at_text,
                person_email, person_name, domain, owner_name, subject, body, campaign_id,
                raw->>'eaccount' AS eaccount, raw->'autoTags' AS auto_tags, raw->'profile'->>'linkedinId' AS linkedin_id
           FROM ctx_events
          WHERE source IN ('instantly', 'heyreach')
            AND event_type IN ('email_reply', 'linkedin_reply')
            AND ($1::timestamptz IS NULL OR (updated_at, id) > ($1::timestamptz, $2::bigint))
          ORDER BY updated_at, id
          LIMIT ${PAGE}`,
        [after?.updatedAt || null, after?.id || 0]
      );
      if (!events.length) break;

      const rows = events.map(e => verdictRow({
        id: `${e.source}:${e.source_event_id}`,
        platform: e.source === 'instantly' ? 'email' : 'linkedin',
        campaignExternalId: e.campaign_id,
        email: e.person_email ? e.person_email.toLowerCase() : null,
        name: e.person_name,
        domain: normalizeDomain(e.domain) || domainFromEmail(e.person_email),
        sender: e.source === 'instantly' ? e.eaccount : e.owner_name,
        repliedAt: e.occurred_at,
        body: e.body,
        subject: e.subject,
        tags: Array.isArray(e.auto_tags) ? e.auto_tags : [],
        linkedinId: e.source === 'heyreach' ? e.linkedin_id : null,
      }));
      classified += await upsertRows('dash_reply_verdicts', VERDICT_COLUMNS, rows, { conflict: ['id'] });

      const last = events[events.length - 1];
      after = { updatedAt: last.updated_at_text, id: Number(last.id) };
      await saveCursor(after);

      if (events.length < PAGE) break;
      if (Date.now() > deadline) return { complete: false, classified };
    }

    return { classified };
  },
};
