import { azureDeployment, completeJson } from './llm/azure.js';

/**
 * Reads what a prospect wrote back and labels it with GPT-4.1 mini, one reply
 * per call.
 *
 * One reply per call, deliberately. Batching twenty replies into one prompt
 * let neighbouring replies sway borderline decisions: labelled twice, the "did
 * they say no" decision differed on 17 of 132 negative replies with the first
 * prompt, and on 7 of 192 replies even after tightening it and re-reading every
 * no. Reading each reply on its own brought that to 3 of 192, at about $0.40 per
 * 1,000 replies, and a normal day has a handful.
 *
 * The labels are stored per reply; what counts as negative, or as no real
 * response at all, is decided in dash_v_reply_verdicts, so that rule can
 * change without labelling anything again.
 */

/**
 * Bump after changing the prompt: every reply is labelled again on the next run.
 *   v1  first prompt, batches of 20
 *   v2  one reply per call; deferred needs an invitation to talk later; replies
 *       about a job at Reo.Dev are off_topic; calendar notices are auto.
 *       Checked on 8 known-tricky replies (all as expected), 132 replies earlier
 *       labelled a no and 60 random others (none newly a no, none newly off_topic).
 */
export const PROMPT_VERSION = 'v2';
export const LABELS = ['interested', 'deferred', 'not_the_person', 'unknown', 'off_topic', 'declined', 'unsubscribed', 'auto'];
const MAX_REPLY_CHARS = 1500;

export const modelTag = () => `${azureDeployment()}@${PROMPT_VERSION}`;

const SYSTEM = `You label replies to cold outreach from Reo.Dev, a platform that shows B2B companies which developers are researching their product. Outreach goes out by email and on LinkedIn (a connection request, then messages). A few LinkedIn messages from Reo.Dev are about a job at Reo.Dev rather than a sale.

The input is one reply. "reply" holds only the prospect's own words: our original message, the quoted thread and their signature have been removed. Emails may include the subject line, which usually repeats ours.

Pick exactly one label:
- interested: wants to learn more or move forward. Agrees to a call or demo, proposes times, asks for pricing, a deck, details, a trial or examples, asks how the product works, or says yes.
- deferred: open to it later, and says so: asks to reconnect at a later time, names a later quarter or date, or wants to stay connected.
- not_the_person: a person says they are the wrong contact, have moved on, could not find the right person, or points to someone else.
- unknown: a person answered us but with no clear intent: a thank-you, "nice to connect", an emoji, "what is this?", "how did you get my email?", or saying they already use Reo.Dev.
- off_topic: a person wrote, but not about our sales outreach: asking us for a job, an interview or a referral; answering our message about a job at Reo.Dev (their profile, the role, whether they want to change jobs); pitching their own product or services to us; or unrelated personal matters.
- declined: a no to the offer. Not interested, not relevant, no need, happy with what they have, no budget, drop this, don't follow up. A no stays declined when it says "for now" or "at this time" but does not invite a later conversation.
- unsubscribed: asks to be removed from the list, unsubscribed, or never contacted again.
- auto: not written by a person in answer to us. Out-of-office and leave notices, auto-responders, calendar notifications such as "has declined this invitation", support-ticket acknowledgements, bounces and delivery failures, "this inbox is no longer monitored".

Rules:
- Judge only their words. Never infer a no from the subject line.
- declined needs a clear no to the sales offer. A reply that is only vague, only polite, or about something else is not declined.
- "Not now, reach out in Q1" and "Not on the market at this time, would love to stay connected" are deferred. "Not at present, thanks" and "You can drop this for now" are declined.
- "Thank you for considering my profile for this opportunity, but I'm happy where I am" is off_topic: it answers a job message, not a sales pitch.
- "Not the right person, talk to Priya" is not_the_person. "Not the right person, and we don't need this" is declined.
- A templated message that would read the same to anyone who wrote in is auto, even when it says the person has left and names who to contact instead. A person telling us in their own words that they have moved on is not_the_person.
- Rude or sarcastic refusals are declined. Requests to stop, remove or unsubscribe are unsubscribed, even when polite.
- reason: one short English sentence, under 15 words, saying what decided the label.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // reason before label, so the model commits to what it read before it names it
  required: ['reason', 'label'],
  properties: {
    reason: { type: 'string' },
    label: { type: 'string', enum: LABELS },
  },
};

export function buildPrompt(reply) {
  const item = {
    channel: reply.platform === 'linkedin' ? 'LinkedIn message' : 'email',
    ...(reply.subject ? { subject: String(reply.subject).slice(0, 200) } : {}),
    reply: String(reply.body || '').slice(0, MAX_REPLY_CHARS),
  };
  return `Label this reply.\n\n${JSON.stringify(item, null, 1)}`;
}

/** Model output → { label, reason }, or null when it is not a label we know. */
export function parseLabel(value) {
  if (!LABELS.includes(value?.label)) return null;
  return { label: value.label, reason: String(value.reason || '').slice(0, 300) };
}

/**
 * Labels one { platform, subject, body }.
 *
 * Returns { label, reason }, or { error } when there is no label: 'refused' when
 * the content filter blocked it (asking again gets the same answer), 'no_answer'
 * when two tries gave nothing usable. Anything else, such as an auth failure or a
 * network error that outlasted completeJson's retries, is thrown so the run stops
 * instead of recording replies as unlabelled.
 */
export async function classifyReply(reply, { complete = completeJson } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { value } = await complete({ system: SYSTEM, user: buildPrompt(reply), schema: SCHEMA, schemaName: 'reply_label' });
      const parsed = parseLabel(value);
      if (parsed) return parsed;
    } catch (err) {
      if (err.code === 'refused') return { error: 'refused' };
      if (err.code !== 'invalid_json') throw err;
    }
  }
  return { error: 'no_answer' };
}
