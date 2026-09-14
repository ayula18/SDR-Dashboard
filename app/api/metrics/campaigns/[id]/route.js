import { handle } from '@/lib/api';
import { getCampaignDetail } from '@/lib/metrics/campaigns';
import { parseFilters } from '@/lib/metrics/filters';

/** One campaign (id like "instantly:<uuid>", URL-encoded): funnel, trend, steps, replies, accounts, meetings. */
export async function GET(request, { params }) {
  const { id } = await params;
  return handle(() => getCampaignDetail(decodeURIComponent(id), parseFilters(request.nextUrl.searchParams)));
}
