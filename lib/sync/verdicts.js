import { classifyReply } from '../reply-sentiment.js';

export const VERDICT_COLUMNS = [
  'id', 'platform', 'campaign_external_id', 'person_email', 'person_name', 'company_domain',
  'sender', 'replied_at', 'verdict', 'is_negative', 'is_auto', 'quote', 'classified_at', 'person_linkedin_id',
];

const NOT_INTERESTED_TAG = /not.?interested/i;

/**
 * One inbound reply → a dash_reply_verdicts row.
 *
 * This is the first verdict, from the rule-based classifier (copied from the AI
 * SDR app): it only marks something negative on a clear refusal or opt-out and
 * flags out-of-office and other robots as `auto`. The reply-classify job then
 * labels the reply with GPT-4.1 mini in separate llm_* columns, which these
 * upserts never touch, and dash_v_reply_verdicts prefers that label.
 *
 * The reply's text is not copied here. It lives once in the AI SDR archive
 * (ctx_events), and the labelling job reads it from there; only a short quote
 * is kept for the reply feed. LinkedIn replies keep the writer's HeyReach
 * profile id, which ties them to the campaign that added that person.
 */
export function verdictRow({ id, platform, campaignExternalId, email, name, domain, sender, repliedAt, body, subject, tags = [], linkedinId = null }) {
  const result = classifyReply(body || '', subject || '');
  const auto = result.verdict === 'auto';
  // HeyReach's own "Not interested" tag is a no even when the wording is soft.
  const taggedNo = tags.some(t => NOT_INTERESTED_TAG.test(String(t)));
  const negative = !auto && (result.declined || taggedNo);

  return [
    id, platform, campaignExternalId || null, email || null, name || null, domain || null, sender || null,
    repliedAt || null, negative && !result.declined ? 'declined' : result.verdict, negative, auto,
    result.quote || null, new Date(), linkedinId || null,
  ];
}
