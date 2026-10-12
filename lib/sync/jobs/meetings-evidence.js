import { syncMeetingEvidence } from '../meeting-evidence.js';

export const job = {
  label: 'Meeting outcomes (held, moved or unproven)',
  // Runs after every source has written its bookings, because it decides the
  // outcome for all of them.
  dependsOn: ['meetings-csv', 'meetings-slack', 'meetings-hubspot'],
  weight: 1,
  minSliceMs: 10_000,
  maxAgeHours: 36,

  async run({ mode } = {}) {
    return syncMeetingEvidence(mode === 'full' ? { days: 365 } : {});
  },
};
