import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { getMeetings } from '@/lib/metrics/meetings';

/** Meetings from the audit sheet with breakdowns. Extra param: channel (SDR, Referral, Inbound, Ads, …). */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => getMeetings(parseFilters(params), { channel: params.get('channel') || null }));
}
