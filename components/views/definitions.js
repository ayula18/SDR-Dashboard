/**
 * What each number on the dashboard counts, worded once so every page says the
 * same thing (Ayush, 2026-11-04: a dashboard built for visibility has to say
 * what "emails sent" means). Shown as tile notes, card subtitles and column
 * hints. Change the rule in lib/metrics first, then the words here.
 *
 * The rules behind them: outreach volumes are the first touch only, except the
 * channel cards' "Emails sent", which has the follow-ups too (2026-11-05);
 * replies, positives and meetings are counted once, on the day they happened,
 * whenever the person was reached (an open view, not a cohort). Meetings are
 * only ever the ones SDR outreach booked. SDR positives are what the SDRs logged on
 * the positive response sheet, then what they booked without logging; other campaigns'
 * are our reply labels (2026-11-05).
 */

// Programs on our labels until their replies reach the sheet, as dash_programs.positives_from_labels
// says (027). Take them out here when that flag is cleared.
const LABELS_FOR_NOW = 'HuggingFace and WVI';
// The waterfall behind an SDR's positives: what they logged, then what they booked without logging.
const SDR_SOURCE = 'From the positive response sheet, plus booked meetings nobody logged there';

export const DEFS = {
  companies: 'Actual company count will be lower, as each domain is counted as an account',
  emailsSent: 'Every email sent, follow-ups included',
  peopleEmailed: 'Each person once, on the day of their first email',
  firstEmails: 'First emails only; follow-ups not counted',
  invites: 'Connection requests sent',
  accepted: 'On the day they accepted, whenever the invite went out',
  firstMessages: 'First message to each person; follow-ups not counted',
  replied: 'Each person once, on the day they first replied',
  positive: `SDRs: the positive response sheet, plus booked meetings nobody logged there. Other campaigns, and ${LABELS_FOR_NOW} for now: our reply labels`,
  positiveSource: `${SDR_SOURCE}. ${LABELS_FOR_NOW}: our reply labels for now`,
  positiveSdr: `Email and LinkedIn. ${SDR_SOURCE}. ${LABELS_FOR_NOW}: our reply labels for now`,
  repliedBoth: 'Email and LinkedIn. Each person once, on the day they first replied',
  positiveList: `SDR responses come from the positive response sheet, matched to their reply where we have it, plus booked meetings nobody logged there. AI SDR and other campaigns come from our reply labels, and so do ${LABELS_FOR_NOW} for now, until those replies are on the sheet.`,
  positiveListSdr: `${SDR_SOURCE}, matched to the reply where we have it. ${LABELS_FOR_NOW} replies come from our reply labels for now.`,
  meetings: 'Booked by SDR outreach, by meeting date',
  meetingsEmail: 'Booked by SDRs from an email campaign, by meeting date',
  meetingsLinkedin: 'Booked by SDRs from a LinkedIn campaign, by meeting date',
  positiveRate: 'Email only: positive email replies that came in, per first email sent, in the same dates',
  ratesEmail: 'Out of the people first emailed in these dates. Positives and meetings count on the day they happen, so some come from people emailed earlier.',
  ratesLinkedin: 'Out of the invites sent in these dates. Acceptances, positives and meetings count on the day they happen, so some come from earlier invites.',
};
