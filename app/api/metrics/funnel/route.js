import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getFunnelTrend } from '@/lib/metrics/funnel';

/** The funnel over the last full days, weeks or months: `grain` (day | week | month), `count`. */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => getFunnelTrend(parseFilters(params), {
    grain: params.get('grain') || 'week',
    count: params.get('count'),
  }));
}
