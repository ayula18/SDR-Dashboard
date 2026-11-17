/**
 * What a person on dash_team does, defined once (`dash_team.role`):
 *   sdr        one of the six SDRs, on every SDR list
 *   sdr_extra  ran SDR campaigns, shown only when picked by name (030)
 *   caller     cold calls on Nooks and runs no campaigns (034; Ayush, 2026-11-17: "for now
 *              pranesh and yashika will be making calls"). On the SDR page's Call view only.
 *   other      not outreach: their meetings are not SDR meetings
 *
 * Outreach roles are the people whose bookings the meeting credit counts, who appear in
 * the SDR filter and who can be named on Meeting checks. Anyone else booking a meeting
 * has not booked an outreach meeting.
 */
export const ROLE_LABELS = {
  sdr: 'SDR',
  sdr_extra: 'SDR, shown only when picked',
  caller: 'Caller (Nooks), on the Call view',
  other: 'Not an SDR',
};

export const ROLES = Object.keys(ROLE_LABELS);

/** In this order in the SDR filter: the SDRs, then the people a list shows only when picked, then the callers. */
export const OUTREACH_ROLES = ['sdr', 'sdr_extra', 'caller'];

export const isOutreachRole = role => OUTREACH_ROLES.includes(role);
