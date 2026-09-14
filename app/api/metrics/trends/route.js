import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getTrends } from '@/lib/metrics/trends';

/** Week-by-week or month-by-month series with WoW / MoM change. Extra param: count (periods, default 12). */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => getTrends(parseFilters(params), { count: Number(params.get('count')) || 12 }));
}
