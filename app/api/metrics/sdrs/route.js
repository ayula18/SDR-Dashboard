import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getSdrBoard } from '@/lib/metrics/funnel';

/** Each SDR's funnel for exactly the dates picked; `channel=call` lists who makes calls. */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => getSdrBoard(parseFilters(params), { channel: params.get('channel') }));
}
