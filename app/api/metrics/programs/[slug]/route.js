import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getProgramDetail, programStart } from '@/lib/metrics/programs';

/**
 * One program. Extra param: channel (both | email | linkedin). With no range, or
 * range=since-start, it covers everything since the program's first campaign;
 * a span that long buckets its trend by month, which `parseFilters` decides.
 */
export async function GET(request, { params }) {
  const { slug } = await params;
  const search = new URLSearchParams(request.nextUrl.searchParams);
  return handle(async () => {
    const range = search.get('range');
    if (!search.get('from') && (!range || range === 'since-start')) {
      const start = await programStart(slug);
      if (start) {
        search.set('range', 'since-start');
        search.set('from', start);
      } else {
        search.delete('range');
      }
    }
    return getProgramDetail(slug, parseFilters(search), { channel: search.get('channel') || 'both' });
  });
}
