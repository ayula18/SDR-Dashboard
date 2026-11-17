'use client';

import { fmtInt, fmtPct } from '@/lib/client/format';
import { DEFS } from './definitions';

/**
 * Each channel's funnel in reading order. `board` marks the numbers the SDR page and
 * SDR Detailed - Metrics show (Ayush, 2026-11-06: the SDR output sheet's columns, with both
 * email counts).
 */
export const FUNNEL = {
  email: [
    { key: 'emailsSent', label: 'Total emails', note: 'all steps', hint: DEFS.emailsSent, board: true },
    { key: 'firstEmails', label: 'First emails', note: 'step 1 only', hint: DEFS.firstEmails, board: true },
    { key: 'emailReplies', label: 'Replies', hint: DEFS.replied },
    { key: 'emailPositive', label: 'Positive responses', hint: DEFS.positive, board: true, outcome: 'positive' },
    { key: 'emailMeetings', label: 'Meetings booked', hint: DEFS.meetingsEmail, board: true, outcome: 'meetings' },
  ],
  linkedin: [
    { key: 'invitesSent', label: 'Invites sent', hint: DEFS.invites, board: true },
    { key: 'invitesAccepted', label: 'Invites accepted', hint: DEFS.accepted, board: true },
    { key: 'firstMessages', label: 'First messages', hint: DEFS.firstMessages },
    { key: 'linkedinReplies', label: 'Replies', hint: DEFS.replied },
    { key: 'linkedinPositive', label: 'Positive responses', hint: DEFS.positive, board: true, outcome: 'positive' },
    { key: 'linkedinMeetings', label: 'Meetings booked', hint: DEFS.meetingsLinkedin, board: true, outcome: 'meetings' },
  ],
  // Ayush, 2026-11-17: "calls made, calls connected to real human, positive respone, meeting".
  call: [
    { key: 'callsMade', label: 'Calls made', hint: DEFS.callsMade, board: true },
    { key: 'callsConnected', label: 'Calls connected', note: 'a person picked up', hint: DEFS.callsConnected, board: true },
    // Ayush, 2026-11-17: "Conversations (60+ seconds)", just below calls connected.
    { key: 'conversations', label: 'Conversations', note: '60+ seconds', hint: DEFS.conversations, board: true },
    { key: 'callPositive', label: 'Positive responses', hint: DEFS.positiveCall, board: true, outcome: 'positive' },
    { key: 'callMeetings', label: 'Meetings booked', hint: DEFS.meetingsCall, board: true, outcome: 'meetings' },
  ],
};

/** What each channel is called on screen. */
export const CHANNEL_NAMES = { email: 'Email', linkedin: 'LinkedIn', call: 'Call' };

/**
 * Each channel's rates on the SDR page (Ayush's manager, 2026-11-10: the % rows of
 * the SDR output sheet), worked out on the server from the one definition program pages'
 * % cards use too (emailRates, linkedinRates, callRates): `count` over `base`, as `hint` says.
 */
export const RATES = {
  email: [
    { key: 'emailPositiveRate', label: 'Positive response %', count: 'emailPositive', base: 'firstEmails', unit: 'first emails', digits: 2, hint: DEFS.formulaPositiveEmail, rate: true },
    { key: 'emailMeetingRate', label: 'Meetings booked %', count: 'emailMeetings', base: 'firstEmails', unit: 'first emails', digits: 2, hint: DEFS.formulaMeetingEmail, rate: true },
  ],
  linkedin: [
    { key: 'acceptanceRate', label: 'Acceptance %', count: 'invitesAccepted', base: 'invitesSent', unit: 'invites sent', digits: 1, hint: DEFS.formulaAcceptance, rate: true },
    { key: 'linkedinPositiveRate', label: 'Positive response %', count: 'linkedinPositive', base: 'invitesSent', unit: 'invites sent', digits: 2, hint: DEFS.formulaPositiveLinkedin, rate: true },
    { key: 'linkedinMeetingRate', label: 'Meetings booked %', count: 'linkedinMeetings', base: 'invitesSent', unit: 'invites sent', digits: 2, hint: DEFS.formulaMeetingLinkedin, rate: true },
  ],
  call: [
    { key: 'callConnectRate', label: 'Connect %', count: 'callsConnected', base: 'callsMade', unit: 'calls made', digits: 1, hint: DEFS.formulaConnect, rate: true },
    { key: 'callTalkRate', label: 'Talk %', count: 'conversations', base: 'callsMade', unit: 'calls made', digits: 1, hint: DEFS.formulaTalk, rate: true },
    { key: 'callPositiveRate', label: 'Positive response %', count: 'callPositive', base: 'callsMade', unit: 'calls made', digits: 2, hint: DEFS.formulaPositiveCall, rate: true },
    { key: 'callMeetingRate', label: 'Meetings booked %', count: 'callMeetings', base: 'callsMade', unit: 'calls made', digits: 2, hint: DEFS.formulaMeetingCall, rate: true },
  ],
};

/** A rate as printed, with the two counts behind it on hover, so a rate on a small base reads as one. */
export const fmtRate = (m, row) => (
  <span title={`${fmtInt(row[m.count])} of ${fmtInt(row[m.base])} ${m.unit}`}>{fmtPct(row[m.key], m.digits)}</span>
);

/** "Positive response % = positive responses ÷ first emails (step 1 only) × 100. …", printed wherever the rates are. */
export const rateFormulas = channel => RATES[channel]
  .map(m => `${m.label} = ${m.hint[0].toLowerCase()}${m.hint.slice(1)}.`)
  .join(' ');

/** A metric with what it counts in brackets, where the name alone could be misread. */
export const metricLabel = m => (m.note ? `${m.label} (${m.note})` : m.label);

export const COMPARISONS = [
  { key: 'day', label: 'DoD', title: 'day on day', last: 'the last two full working days', unit: 'working days' },
  { key: 'week', label: 'WoW', title: 'week on week', last: 'the last two full weeks', unit: 'weeks' },
  { key: 'month', label: 'MoM', title: 'month on month', last: 'the last two full months', unit: 'months' },
];

/** DoD, WoW or MoM. */
export function ComparisonButtons({ value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="Compare by">
      {COMPARISONS.map(c => (
        <button key={c.key} type="button" aria-pressed={value === c.key} title={`Compare ${c.title}`} onClick={() => onChange(c.key)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}
