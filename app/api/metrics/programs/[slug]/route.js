import { handle } from '@/lib/api';
import { isoDay, toDay } from '@/lib/outreach/dates';
import { parseFilters } from '@/lib/metrics/filters';
import { getProgramDetail } from '@/lib/metrics/programs';

/** One program. Extra param: since (YYYY-MM-DD, defaults to DASH_START_DATE) for the lifetime funnel. */
export async function GET(request, { params }) {
  const { slug } = await params;
  const search = request.nextUrl.searchParams;
  return handle(() => {
    const since = search.get('since');
    return getProgramDetail(slug, parseFilters(search), since ? { since: isoDay(toDay(since)) } : {});
  });
}
