/**
 * Loads the "Qualified Meetings 2026 - Happened Audit" CSV export into dash_meetings.
 *
 *   npm run import:meetings -- "/path/to/Qualified Meetings 2026 - Happened Audit.csv"
 *   (defaults to MEETINGS_CSV_PATH)
 */

import fs from 'fs';
import path from 'path';
import { importMeetingsCsv } from '../lib/sync/meetings.js';
import { pool } from '../lib/db.js';

const file = process.argv[2] || process.env.MEETINGS_CSV_PATH;
if (!file) {
  console.error('Pass the CSV path, or set MEETINGS_CSV_PATH in .env.local');
  process.exit(1);
}

console.log(await importMeetingsCsv(fs.readFileSync(file, 'utf8'), { sourceFile: path.basename(file) }));
await pool().end();
