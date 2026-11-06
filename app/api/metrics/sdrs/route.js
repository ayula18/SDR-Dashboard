import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getSdrBoard } from '@/lib/metrics/funnel';

/** Each SDR's funnel for exactly the dates picked. */
export async function GET(request) {
  return handle(() => getSdrBoard(parseFilters(request.nextUrl.searchParams)));
}
