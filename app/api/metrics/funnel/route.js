import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getFunnelTrend } from '@/lib/metrics/funnel';

/**
 * The funnel a column per day, week or month: `grain` (day | week | month); `channel` (email |
 * linkedin | call | all), which says who is listed (SDRs, callers, or both for all) and whose
 * last full read the columns wait for; and either `count` last full periods or, when `range`
 * or `from`/`to` is sent, the periods inside those dates.
 * `toDate=1` adds the running day, week or month so far after them.
 */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => {
    const filters = parseFilters(params);
    const picked = params.get('range') || params.get('from') ? { from: filters.from, to: filters.to } : null;
    return getFunnelTrend(filters, {
      grain: params.get('grain') || 'week',
      count: params.get('count'),
      channel: params.get('channel'),
      picked,
      toDate: params.get('toDate') === '1',
    });
  });
}
