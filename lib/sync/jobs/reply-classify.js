import { qp } from '../../db.js';
import { azureConfigured } from '../../llm/azure.js';
import { classifyReply, modelTag } from '../../reply-llm.js';
import { ownWords } from '../../reply-sentiment.js';

const CONCURRENCY = 8;
const SAVE_EVERY = 25;
const NOT_LABELLED = {
  empty: 'Not labelled: the reply has no words of its own',
  refused: 'Not labelled: the model declined this reply',
  no_answer: 'Not labelled: no usable answer in two tries',
};

/**
 * Labels replies with GPT-4.1 mini, one reply per call (lib/reply-llm.js).
 *
 * The text comes from the AI SDR archive (ctx_events), where the AI SDR app's
 * Instantly and HeyReach syncs store every reply once; nothing is copied into
 * dash_* tables. A reply goes to the model only when it has no label for its
 * current text under the current model and prompt version, compared by an md5
 * of the archived subject and body. Replies with no words of their own, or that
 * the model refuses or cannot answer in two tries, are recorded with that
 * fingerprint too, so no reply is ever sent again for the same text. Until a
 * reply is labelled, the keyword verdict from reply-verdicts stands.
 */
export const job = {
  label: 'Reply labels (GPT-4.1 mini)',

  async run({ deadline }) {
    if (!azureConfigured()) return { status: 'skipped', reason: 'Azure OpenAI is not configured' };

    const model = modelTag();
    const pending = await qp(
      `SELECT v.id, v.platform, e.subject, e.body, e.input_hash
         FROM dash_reply_verdicts v
         JOIN LATERAL (
           SELECT subject, body, md5(COALESCE(subject, '') || E'\\n' || COALESCE(body, '')) AS input_hash
             FROM ctx_events
            WHERE source = split_part(v.id, ':', 1)
              AND source_event_id = substr(v.id, length(split_part(v.id, ':', 1)) + 2)
         ) e ON TRUE
        WHERE v.replied_at >= $1
          AND e.body IS NOT NULL AND e.body <> ''
          AND (v.llm_model IS DISTINCT FROM $2 OR v.llm_input_hash IS DISTINCT FROM e.input_hash)
        ORDER BY v.replied_at DESC`,
      [process.env.DASH_START_DATE || '2026-01-05', model]
    );

    const hashOf = new Map(pending.map(r => [r.id, r.input_hash]));
    const save = rows => (rows.length
      ? qp(
        `UPDATE dash_reply_verdicts v
            SET llm_verdict = x.label, llm_reason = x.reason, llm_input_hash = x.input_hash,
                llm_model = $5, llm_classified_at = NOW()
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS x(id, label, reason, input_hash)
          WHERE v.id = x.id`,
        [rows.map(r => r[0]), rows.map(r => r[1]), rows.map(r => r[2]), rows.map(r => hashOf.get(r[0])), model]
      )
      : null);

    const replies = pending.map(r => ({ id: r.id, platform: r.platform, subject: r.subject, body: ownWords(r.body).slice(0, 4000) }));
    const empty = replies.filter(r => !r.body);
    await save(empty.map(r => [r.id, null, NOT_LABELLED.empty]));

    const toLabel = replies.filter(r => r.body);
    const unsaved = [];
    let next = 0;
    let labelled = 0;
    let notLabelled = empty.length;
    const worker = async () => {
      while (next < toLabel.length && Date.now() < deadline) {
        const reply = toLabel[next++];
        const result = await classifyReply(reply);
        if (result.label) labelled++;
        else notLabelled++;
        unsaved.push([reply.id, result.label || null, result.label ? result.reason : NOT_LABELLED[result.error]]);
        if (unsaved.length >= SAVE_EVERY) await save(unsaved.splice(0));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await save(unsaved.splice(0));

    return { complete: next >= toLabel.length, pending: pending.length, labelled, notLabelled };
  },
};
