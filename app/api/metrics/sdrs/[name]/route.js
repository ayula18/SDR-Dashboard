import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getSdrDetail } from '@/lib/metrics/sdrs';

/** One SDR: overview, what works for them, campaigns and meetings. */
export async function GET(request, { params }) {
  const { name } = await params;
  return handle(() => getSdrDetail(name, parseFilters(request.nextUrl.searchParams)));
}
