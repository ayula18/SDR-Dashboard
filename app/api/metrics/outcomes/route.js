import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getOutcomes } from '@/lib/metrics/outcomes';

/** The people behind a Positive or Meetings number. Params: kind (positive | meetings), channel, the usual filters. */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => getOutcomes(parseFilters(params), { kind: params.get('kind'), channel: params.get('channel') }));
}
