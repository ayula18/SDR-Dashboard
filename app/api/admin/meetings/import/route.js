import { handle } from '@/lib/api';
import { badRequest } from '@/lib/metrics/format';
import { importMeetingsCsv } from '@/lib/sync/meetings';

export const maxDuration = 120;

/**
 * Admins: replace meetings with a CSV export of "Qualified Meetings 2026 -
 * Happened Audit". Send the raw CSV as the body; optional X-File-Name header.
 */
export async function POST(request) {
  return handle(async () => {
    const csv = await request.text();
    if (!csv.trim()) throw badRequest('Send the CSV as the request body');
    return importMeetingsCsv(csv, { sourceFile: request.headers.get('x-file-name') || 'upload' });
  }, { admin: true });
}
