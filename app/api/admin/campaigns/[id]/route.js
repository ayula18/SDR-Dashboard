import { handle } from '@/lib/api';
import { clearCampaignOverride, setCampaignOverride } from '@/lib/admin';

/**
 * Admins: correct a campaign's SDR, program, theme or segment, or exclude it.
 * Body: { sdr?, program?, theme?, segment?, excluded?, note? }. null restores
 * the value parsed from the name; '' clears it.
 */
export async function PATCH(request, { params }) {
  const { id } = await params;
  return handle(async user => setCampaignOverride(decodeURIComponent(id), await request.json().catch(() => ({})), user), { admin: true });
}

/** Admins: drop the override so the parsed values apply again. */
export async function DELETE(request, { params }) {
  const { id } = await params;
  return handle(() => clearCampaignOverride(decodeURIComponent(id)), { admin: true });
}
