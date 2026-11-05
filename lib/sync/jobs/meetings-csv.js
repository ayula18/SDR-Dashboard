import fs from 'fs';
import path from 'path';
import { importMeetingsCsv } from '../meetings.js';

export const job = {
  label: 'Meetings audit sheet (CSV on disk)',
  weight: 1,
  minSliceMs: 10_000,
  // No maxAgeHours. This is a snapshot someone exports, and Vercel has no disk to read
  // it from, so no run can make it fresher. getMeta warns about what it covers instead.

  async run() {
    const file = process.env.MEETINGS_CSV_PATH;
    if (!file || !fs.existsSync(file)) {
      return { status: 'skipped', reason: 'MEETINGS_CSV_PATH is not set or missing; upload the CSV via /api/admin/meetings/import' };
    }
    return importMeetingsCsv(fs.readFileSync(file, 'utf8'), { sourceFile: path.basename(file) });
  },
};
