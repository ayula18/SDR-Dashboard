import { syncMeetingCredit } from '../meeting-credit.js';

/**
 * Who booked each meeting and where it came from (lib/outreach/meeting-credit.js),
 * from what the meetings jobs, the outreach syncs and the archive already hold: no
 * API call. Runs after every meetings job, since it weighs all of their records,
 * and before the positive sheet, whose booked positives follow the credit.
 */
export const job = {
  label: 'Meeting credit (who booked each meeting, and from which outreach)',
  dependsOn: ['meetings-sheet', 'meetings-slack', 'meetings-sdr-form', 'meetings-hubspot', 'meetings-evidence'],
  weight: 1,
  minSliceMs: 20_000,
  maxAgeHours: 36,

  async run() {
    return syncMeetingCredit();
  },
};
