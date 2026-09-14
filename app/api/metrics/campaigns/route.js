import { handle } from '@/lib/api';
import { getCampaignsPage } from '@/lib/metrics/campaigns';
import { parseFilters } from '@/lib/metrics/filters';

/**
 * Campaigns on both channels. Extra params: show (active: activity in the range, the default;
 * current: running now or active in the range; running; all), all=1 (same as show=all),
 * q (name search), platform, limit.
 */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => getCampaignsPage(parseFilters(params), {
    includeInactive: params.get('all') === '1',
    show: params.get('show') || 'active',
    search: params.get('q') || null,
    platform: params.get('platform') || null,
    limit: Math.min(Number(params.get('limit')) || 500, 2000),
  }));
}
