import { syncHubspotMeetings } from '../hubspot-meetings.js';

export const job = {
  label: 'Meetings booked (HubSpot, where the other sources are silent)',
  weight: 1,
  minSliceMs: 10_000,
  maxAgeHours: 36,

  /** A full run reaches back a year; a daily run only needs the recent window. */
  async run({ mode } = {}) {
    return syncHubspotMeetings(mode === 'full' ? { days: 365 } : {});
  },
};
