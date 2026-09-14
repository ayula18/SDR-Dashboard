import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getOverview } from '@/lib/metrics/overview';

/**
 * Headline KPIs vs the previous period, outreach funnel and 12-period trend.
 * Shared query params: range (this-week, last-week, last-4-weeks, last-12-weeks,
 * this-month, last-month, last-3-months, ytd) or from/to, grain (week|month),
 * sdr, program, theme.
 */
export async function GET(request) {
  return handle(() => getOverview(parseFilters(request.nextUrl.searchParams)));
}
