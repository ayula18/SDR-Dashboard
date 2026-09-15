import { handle } from '@/lib/api';
import { getConversation } from '@/lib/metrics/conversation';

/**
 * One company's outreach conversation, read live from the AI SDR archive.
 * Params: company (a domain, or name:<company key>), program, channel (both | email | linkedin).
 */
export async function GET(request) {
  const search = request.nextUrl.searchParams;
  return handle(() => getConversation({
    company: search.get('company'),
    program: search.get('program') || null,
    channel: search.get('channel') || 'both',
  }));
}
