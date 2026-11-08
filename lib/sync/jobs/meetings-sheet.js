import { syncMeetingsSheet } from '../meetings.js';

/**
 * The meetings audit, read daily from the Combined QMeeings Booked-2026 sheet with the
 * icp-dashboard@ service account, read-only (lib/outreach/google-sheets.js). Runs before
 * the alert, form and HubSpot jobs, which each stand aside where the audit holds a meeting.
 */
export const job = {
  label: 'Meetings booked (the audit sheet, Combined QMeeings Booked-2026)',
  weight: 1,
  minSliceMs: 15_000,
  maxAgeHours: 36,

  async run() {
    return syncMeetingsSheet();
  },
};
