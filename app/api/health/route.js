import { handle } from '@/lib/api';
import { getHealth } from '@/lib/metrics/health';

/** Sync status, setup gaps, freshness and campaign-mapping problems. */
export async function GET() {
  return handle(() => getHealth());
}
