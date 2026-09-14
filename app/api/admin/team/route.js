import { handle } from '@/lib/api';
import { upsertTeamMember } from '@/lib/admin';
import { qp } from '@/lib/db';

/** The roster used to attribute campaigns to SDRs. */
export async function GET() {
  return handle(async () => ({
    team: await qp(`SELECT name, aliases, role, email, color, is_active AS "isActive" FROM dash_team ORDER BY role, name`),
  }));
}

/**
 * Admins: add or update a roster entry, then re-parse every campaign name.
 * Body: { name, role?: 'sdr' | 'other', aliases?: string[], email?, color?, isActive? }
 */
export async function POST(request) {
  return handle(async () => upsertTeamMember(await request.json().catch(() => ({}))), { admin: true });
}
