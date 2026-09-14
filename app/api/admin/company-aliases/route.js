import { handle } from '@/lib/api';
import { clearCompanyAlias, setCompanyAlias } from '@/lib/admin';

/**
 * Admins: say which domain a LinkedIn company name belongs to, for everyone at
 * that company. Body: { name, domain } or { name, notACompany: true }.
 */
export async function POST(request) {
  return handle(async user => setCompanyAlias(await request.json().catch(() => ({})), user), { admin: true });
}

/** Admins: undo a mapping. Query param: key (from GET /api/health). */
export async function DELETE(request) {
  return handle(() => clearCompanyAlias(request.nextUrl.searchParams.get('key')), { admin: true });
}
