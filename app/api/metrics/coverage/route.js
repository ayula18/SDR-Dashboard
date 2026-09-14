import { handle } from '@/lib/api';
import { getCoverage } from '@/lib/metrics/coverage';
import { parseFilters } from '@/lib/metrics/filters';

/** Allocation and coverage by load week and SDR, reloaded/shared accounts, and the account table. Extra params: q, limit. */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => getCoverage(parseFilters(params), {
    search: params.get('q') || null,
    limit: Math.min(Number(params.get('limit')) || 300, 2000),
  }));
}
