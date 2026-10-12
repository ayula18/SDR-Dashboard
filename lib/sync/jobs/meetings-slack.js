import { syncSlackMeetings } from '../slack-meetings.js';

export const job = {
  label: 'Meetings booked (Slack alerts, from the archive)',
  weight: 1,
  minSliceMs: 10_000,
  maxAgeHours: 36,

  /** A full run re-reads a year of alerts; a daily run only needs the recent window. */
  async run({ mode } = {}) {
    return syncSlackMeetings(mode === 'full' ? { days: 365 } : {});
  },
};
