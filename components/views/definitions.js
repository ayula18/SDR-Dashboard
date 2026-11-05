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
 * the positive response sheet; other campaigns' are our reply labels (2026-11-05).
 */
export const DEFS = {
  companies: 'Actual company count will be lower, as each domain is counted as an account',
  emailsSent: 'Every email sent, follow-ups included',
  peopleEmailed: 'Each person once, on the day of their first email',
  firstEmails: 'First emails only; follow-ups not counted',
  invites: 'Connection requests sent',
  accepted: 'On the day they accepted, whenever the invite went out',
  firstMessages: 'First message to each person; follow-ups not counted',
  replied: 'Each person once, on the day they first replied',
  positive: 'SDRs: from the positive response sheet. Other campaigns: our reply labels',
  positiveSdr: 'From the positive response sheet',
  meetings: 'Booked by SDR outreach, by meeting date',
  meetingsEmail: 'Booked by SDRs from an email campaign, by meeting date',
  meetingsLinkedin: 'Booked by SDRs from a LinkedIn campaign, by meeting date',
  positiveRate: 'Positive replies that came in, per first email sent, in the same dates',
};
