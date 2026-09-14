import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getInsights } from '@/lib/metrics/insights';

/** What's working: SDR × theme, firmographics, sequence steps, best copy, LinkedIn senders. */
export async function GET(request) {
  return handle(() => getInsights(parseFilters(request.nextUrl.searchParams)));
}
