import { handle } from '@/lib/api';
import { getMeta } from '@/lib/metrics/meta';

/** Filter options (SDRs, programs, themes, ranges) and data warnings. */
export async function GET() {
  return handle(() => getMeta());
}
