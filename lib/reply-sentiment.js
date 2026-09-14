/**
 * What an inbound reply actually SAID.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Every inbound reply in the archive was stored as `outcome: 'positive'`. The
 * connector meant "engagement happened" — the comment there says so — and the
 * plan was to judge sentiment later, at brief time. Nothing on the drafting
 * path ever did.
 *
 * So across 11,820 inbound replies the archive holds exactly two states,
 * `positive` (1,316) and NULL (10,504). Not one prospect reply has ever been
 * marked negative, including these:
 *
 *     "No this is not relevant, thanks"        adam @ teleskope.ai
 *     "No thank you"                           dominodatalab.com
 *     "no thank you"                           bitwarden.com
 *     "Not interested anymore. Thank you"      singlestore.com
 *     "please remove me from your list"        dremio.com
 *     "Unsubscribe"                            katalon.com, blitzy.com, rocket.chat
 *
 * The consequence was not merely a bad statistic. A refusal marked `positive`
 * matched the composer's "meetings and positive outcomes" filter, so it entered
 * the prompt twice — once as a reply and once as a WIN — and prompt rule 3 then
 * ordered the model to "build the message on it, echo their own framing back to
 * them". Given six words it invented the rest, and teleskope.ai received:
 *
 *     Last time, you said the AI/ML evaluation angle was "not relevant."
 *
 * Adam never said that. He said "No this is not relevant, thanks", about the
 * whole message, ten months earlier.
 *
 * ── HOW THESE RULES WERE BUILT ─────────────────────────────────────────────
 *
 * From the 318 rejection-shaped replies actually in the archive, read by hand,
 * the same way assignment-verdict.js was built from 993 real SDR comments. The
 * phrasings below are quoted from real messages, not imagined.
 */

/**
 * Strip our own quoted message off the bottom of a reply.
 *
 * This matters more than it looks. The stored body contains the ENTIRE thread,
 * so a four-word brush-off arrives as two thousand characters of our own copy
 * with "No this is not relevant, thanks" at the top. Every keyword below would
 * otherwise match against our own outreach.
 */
/**
 * Cut the signature block off the end of a reply.
 *
 * Corporate footers carry compliance boilerplate that reads exactly like the
 * thing we are looking for. SHI's signature says "You can unsubscribe from
 * sales communications here" on EVERY message, and SHI was mid-purchase-order
 * for Cisco — thirteen messages about W9s and EULAs, every one of which this
 * classifier blocked as an opt-out before signatures were stripped. DefectDojo's
 * says "Note: Please reply to unsubscribe" under a thank-you note.
 *
 * The signature is whatever follows a sign-off, an embedded image, or a phone
 * block. Sign-offs only count past the first 25 characters, so a message that
 * IS "No thanks" survives intact.
 */
function stripSignature(text) {
  let t = String(text || '');
  const cuts = [
    /\[cid:/i,                                   // embedded image = signature
    /\[image:\s/i,                                // the other inline-image form
    /\bYou can unsubscribe from [^.]{0,60}here\b/i,  // footer boilerplate
    /\bPlease reply to unsubscribe\b/i,
    /\bTo unsubscribe[, ]/i,
    /\bthis e-?mail (and any attachments |)is confidential/i,
  ];
  for (const re of cuts) {
    const m = t.search(re);
    if (m >= 0) t = t.slice(0, m);
  }
  // A sign-off, but only once we are past the greeting and the message itself.
  const signoff = /\b(best regards|kind regards|warm regards|best wishes|regards,|best,|cheers,|sincerely|thanks,\s*[A-Z]|thank you,\s*[A-Z])/i;
  const at = t.search(signoff);
  if (at >= 25) t = t.slice(0, at);
  return t.trim();
}

export function ownWords(body) {
  return stripSignature(String(body || '')
    // "On Tue, Nov 4, 2025 at 10:13 AM Piyush Agarwal <…> wrote:"
    //
    // The `s` flag is load-bearing: Gmail wraps this attribution across lines,
    // putting "wrote:" on its own line, and without dotAll the split silently
    // failed and every reply carried our entire original message as "their
    // words". That is what let a six-word brush-off look like a conversation.
    .split(/\n?\s*On\s.{0,80}\d{4}.{0,160}?wrote:/is)[0]
    // Base64 inline images, which run for thousands of characters and can carry
    // any letter sequence you care to look for.
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, ' ')
    // Outlook-style quoted headers. The newline is OPTIONAL: filigran.io's
    // signature runs straight into "From: … Subject: Re: … not relevant …", and
    // requiring a line break left the quoted SUBJECT in their own words, which
    // blocked a message that said "please share the contract".
    .split(/(?:^|\s)(?:From|Sent|To|Cc|Subject):\s+\S/i)[0]
    .split(/\n\s*_{5,}/)[0]
    .split(/\n\s*-{5,}\s*Original Message/i)[0]
    // Quoted lines
    .replace(/^\s*>.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim());
}

/** Out of office, ticket acknowledgements, mailbox robots. Not a human answer. */
const AUTO = /\b(out of (the )?office|automatic reply|auto-?reply|autoresponder|on (?:\w+ ){0,2}(leave|holiday|vacation|break)\b|currently ooo|\booo\b|i am travelling|away from my desk|will be back on|returning (on|april|may|june|july|august|september|october|november|december|january|february|march|\w+ \d)|bereavement|we have received your request|ticket #?\d|no longer with|has left the company|is no longer at)\b/i;

/**
 * A compliance event, not an opinion. "Unsubscribe" and "remove me from your
 * list" are requests to stop, and they outrank everything else in this file.
 */
const UNSUBSCRIBE = /\b(unsubscribe|remove me from your (list|database)|take me off (your |the )?(list|distribution)|opt.?out (of|from) (your |these |all )?(list|e-?mails?|communications?|marketing)|stop emailing|do not (contact|email) me|please stop)\b/i;

/**
 * A clear no. Every alternative below is quoted from a real reply.
 *
 * The leading-boundary forms ("no thanks", "not interested") are deliberately
 * permissive about surrounding punctuation because these arrive as the entire
 * message: "No thanks", "no thank you", "Thanks but no thank you".
 */
const DECLINED = new RegExp([
  'not interested',
  'no thank ?you',
  "no,? thanks",
  'not relevant',
  'not a fit', 'not the right fit',
  // "No need. thanks." (shuttle.dev) is a refusal. "There's no need to prepare
  // anything" (appsmith, mid-deal) is not, and neither is "no need for a call
  // tomorrow". The refusal form stands alone.
  'no need\\b(?!\\s+(?:to|for)\\b)',
  "we (?:are|'re) not looking", 'not looking (?:for|into|at)',
  "don'?t think .{0,40}\\bappetite\\b",
  'decided not to (?:move forward|proceed)',
  "won'?t be moving forward", 'not moving forward',
  'not (?:going to be )?proceed(?:ing)?',
  'not at this time',
  'no budget',
  // "I'm going to pass it along to our RevOps team" (solo.io) is a REFERRAL.
  'pass on this', 'going to pass\\b(?!\\s+(?:it|this|that|along|to))',
].join('|'), 'i');

// DELIBERATELY ABSENT, having been tried and measured against the archive:
//   /we (already )?use \w+/   — 9 false blocks. "We use Salesforce", "yes we use
//                               Slack", "we use a tool called Zulip". Every one
//                               was a CUSTOMER mid-integration, not a refusal.
//   /already have (a|an|some)/ — "We already have some of these... but perhaps
//                               what you have is better. Can you send some" is
//                               an invitation, and it was being read as a no.

/**
 * Right company, wrong human. This is NOT a rejection — it is often a referral,
 * and the correct next move is a different person, not silence.
 */
const NOT_THE_PERSON = /\b(not the right (person|contact)|wrong person|i'?m not who|this (falls under|belongs to)|forward(ing|ed)? (this|your) (message|note|email) (along|to)|reach out to \w+|speak (to|with) \w+ instead|our \w+ team (handles|owns))\b/i;

/** Interested, but later. A real answer that must not be read as a refusal. */
const DEFERRED = /\b(not the right time|right now is not|circle back|reconnect (around|in)|revisit|touch ?base (later|sometime)|next (quarter|year|month)|in (a )?(few|couple) (of )?(weeks|months)|bandwidth issue|pause this for now|keep(ing)? (you|this) (in mind|top of mind)|not sure when)\b/i;

/** Explicitly moving forward. Deliberately narrow — this one grants permission. */
const INTERESTED = /\b(would like to move forward|happy to (talk|chat|connect)|let'?s (talk|chat|set up|schedule)|sounds (great|interesting|good)|send (me |over )?(some|more|a few|the)|interested in (learning|seeing|knowing)|book (a|some) time|works for me|dive (a bit )?deeper|eager to get)\b/i;

/**
 * @param {string} body     the raw stored body, thread and all
 * @param {string} [subject]
 * @returns {{
 *   verdict: 'auto'|'unsubscribed'|'declined'|'not_the_person'|'deferred'|'interested'|'unknown',
 *   declined: boolean,   // they said no
 *   blocking: boolean,   // do not write again without a human deciding
 *   text: string,        // THEIR words only
 *   quote: string,       // a short excerpt, safe to show a reviewer
 *   outcome: string|null // value for ctx_events.outcome
 * }}
 */
export function classifyReply(body, subject = '') {
  const text = ownWords(body);
  // SENTIMENT COMES FROM THEIR BODY ONLY.
  //
  // A reply's subject is "Re: <our subject>" — our words, not theirs. Matching
  // against it blocked filigran.io, who wrote "Sounds good, please share the
  // contract", because the thread subject further up contained "not relevant".
  // The subject is still used for AUTO, where "Automatic reply:" is the signal.
  const hay = text;
  const quote = text.slice(0, 160);
  const base = { text, quote, declined: false, blocking: false };

  // An empty or emoji-only reply says nothing either way. The archive is full of
  // "👍" and "🚀🚀" from LinkedIn; reading those as interest is how a thumbs-up
  // becomes a pipeline stage.
  if (text.replace(/[\p{Emoji}\p{P}\s]/gu, '').length < 2) {
    return { ...base, verdict: 'unknown', outcome: null };
  }

  // Robots first: an out-of-office contains no opinion, and its "I will be back"
  // would otherwise read as a deferral.
  if (AUTO.test(`${subject || ''} ${text}`)) return { ...base, verdict: 'auto', outcome: null };

  // Compliance outranks sentiment.
  if (UNSUBSCRIBE.test(hay)) {
    return { ...base, verdict: 'unsubscribed', declined: true, blocking: true, outcome: 'negative' };
  }

  // A refusal is checked BEFORE a referral, because the two co-occur and the
  // safe reading wins: "I'm not the right person for this convo and don't think
  // the sales leaders here have an appetite for any new tools" (ipinfo.io) is a
  // no, whatever else it also is.
  if (DECLINED.test(hay)) {
    return { ...base, verdict: 'declined', declined: true, blocking: true, outcome: 'negative' };
  }

  if (NOT_THE_PERSON.test(hay)) return { ...base, verdict: 'not_the_person', outcome: 'neutral' };
  if (DEFERRED.test(hay))       return { ...base, verdict: 'deferred', outcome: 'neutral' };
  if (INTERESTED.test(hay))     return { ...base, verdict: 'interested', outcome: 'positive' };

  // Unmatched is UNKNOWN, never positive. The whole defect this file exists to
  // fix came from a default that assumed the best.
  return { ...base, verdict: 'unknown', outcome: null };
}

/** Verdicts that mean "do not send to this account without a person deciding". */
export const BLOCKING_VERDICTS = new Set(['declined', 'unsubscribed']);
