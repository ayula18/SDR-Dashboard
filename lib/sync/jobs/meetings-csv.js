import fs from 'fs';
import path from 'path';
import { importMeetingsCsv } from '../meetings.js';

export const job = {
  label: 'Meetings audit sheet (CSV on disk)',

  async run() {
    const file = process.env.MEETINGS_CSV_PATH;
    if (!file || !fs.existsSync(file)) {
      return { status: 'skipped', reason: 'MEETINGS_CSV_PATH is not set or missing; upload the CSV via /api/admin/meetings/import' };
    }
    return importMeetingsCsv(fs.readFileSync(file, 'utf8'), { sourceFile: path.basename(file) });
  },
};
