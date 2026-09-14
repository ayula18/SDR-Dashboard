import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getLeaderboard } from '@/lib/metrics/sdrs';

/** SDR leaderboard for the range, with previous-period change. */
export async function GET(request) {
  return handle(() => getLeaderboard(parseFilters(request.nextUrl.searchParams)));
}
