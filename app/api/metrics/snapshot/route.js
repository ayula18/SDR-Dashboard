import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getSnapshot } from '@/lib/metrics/snapshot';

/** Snapshot View: per person and segment, for the dates picked; this week so far when none are. */
export async function GET(request) {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  if (!params.get('range') && !params.get('from')) params.set('range', 'this-week');
  return handle(() => getSnapshot(parseFilters(params)));
}
