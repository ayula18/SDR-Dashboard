import { handle } from '@/lib/api';
import { parseFilters } from '@/lib/metrics/filters';
import { listPrograms } from '@/lib/metrics/programs';

/** Specialized programs (HuggingFace, Common Room, …) with funnels and period change. */
export async function GET(request) {
  return handle(() => listPrograms(parseFilters(request.nextUrl.searchParams)));
}
