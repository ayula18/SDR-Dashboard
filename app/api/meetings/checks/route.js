import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getMeetingChecks } from '@/lib/metrics/meetings';

/** The meetings the credit could not settle, for Meeting checks. Takes the usual range and SDR filters. */
export async function GET(request) {
  return handle(() => getMeetingChecks(parseFilters(request.nextUrl.searchParams)));
}
