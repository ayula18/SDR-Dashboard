import { handle } from '@/lib/api';
import { getDashboard } from '@/lib/metrics/dashboard';
import { parseFilters } from '@/lib/metrics/filters';

// The company funnel and the meetings view are the two slow reads behind this page.
export const maxDuration = 60;

/**
 * The whole effort for a range, in the same shape as a program page: the company
 * funnel, each channel's volumes and replies, meetings booked and held, a
 * 12-period trend, and the SDRs and programs behind it.
 *
 * Shared query params: range (this-week, last-week, last-4-weeks, last-12-weeks,
 * this-month, last-month, last-3-months, ytd) or from/to, grain (week|month),
 * sdr, program, theme. Extra param: channel (both | email | linkedin).
 */
export async function GET(request) {
  const params = request.nextUrl.searchParams;
  return handle(() => getDashboard(parseFilters(params), { channel: params.get('channel') || 'both' }));
}
