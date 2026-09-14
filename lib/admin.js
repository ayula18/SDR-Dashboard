import { qp } from './db.js';
import { reparseCampaigns } from './sync/parse.js';
import { badRequest, notFound } from './metrics/format.js';
import { normalizeDomain } from './outreach/domains.js';
import { companyKey } from './outreach/linkedin.js';

const text = v => (v === undefined ? undefined : v === null ? null : String(v).trim());

/**
 * Corrects what the name parser decided for one campaign. Fields left out keep
 * their current override; null restores the parsed value; '' clears it.
 */
export async function setCampaignOverride(campaignId, input, user) {
  const [campaign] = await qp(`SELECT id FROM dash_campaigns WHERE id = $1`, [campaignId]);
  if (!campaign) throw notFound(`No campaign ${campaignId}`);

  const [existing = {}] = await qp(`SELECT sdr, program, theme, segment, excluded, note FROM dash_campaign_overrides WHERE campaign_id = $1`, [campaignId]);
  const next = {
    sdr: text(input.sdr) !== undefined ? text(input.sdr) : existing.sdr ?? null,
    program: text(input.program) !== undefined ? text(input.program) : existing.program ?? null,
    theme: text(input.theme) !== undefined ? text(input.theme) : existing.theme ?? null,
    segment: text(input.segment) !== undefined ? text(input.segment) : existing.segment ?? null,
    excluded: input.excluded !== undefined ? Boolean(input.excluded) : existing.excluded ?? false,
    note: text(input.note) !== undefined ? text(input.note) : existing.note ?? null,
  };

  if (next.sdr) {
    const [member] = await qp(`SELECT name FROM dash_team WHERE name = $1`, [next.sdr]);
    if (!member) throw badRequest(`"${next.sdr}" is not on the team roster`);
  }
  if (next.program) {
    const [program] = await qp(`SELECT slug FROM dash_programs WHERE slug = $1`, [next.program]);
    if (!program) throw badRequest(`"${next.program}" is not a program`);
  }

  await qp(
    `INSERT INTO dash_campaign_overrides (campaign_id, sdr, program, theme, segment, excluded, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (campaign_id) DO UPDATE
       SET sdr = EXCLUDED.sdr, program = EXCLUDED.program, theme = EXCLUDED.theme, segment = EXCLUDED.segment,
           excluded = EXCLUDED.excluded, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [campaignId, next.sdr, next.program, next.theme, next.segment, next.excluded, next.note, user.email]
  );
  return { campaignId, override: next };
}

export async function clearCampaignOverride(campaignId) {
  await qp(`DELETE FROM dash_campaign_overrides WHERE campaign_id = $1`, [campaignId]);
  return { campaignId, override: null };
}

const ROLES = new Set(['sdr', 'other']);

/** Adds or updates a roster entry, then re-parses campaign names so attribution follows. */
export async function upsertTeamMember(input) {
  const name = text(input.name);
  if (!name) throw badRequest('name is required');
  const role = text(input.role) || 'sdr';
  if (!ROLES.has(role)) throw badRequest(`role must be one of ${[...ROLES].join(', ')}`);
  const aliases = Array.isArray(input.aliases) ? input.aliases.map(a => String(a).trim().toLowerCase()).filter(Boolean) : [];

  await qp(
    `INSERT INTO dash_team (name, aliases, role, email, color, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (name) DO UPDATE
       SET aliases = EXCLUDED.aliases, role = EXCLUDED.role, email = COALESCE(EXCLUDED.email, dash_team.email),
           color = COALESCE(EXCLUDED.color, dash_team.color), is_active = EXCLUDED.is_active, updated_at = NOW()`,
    [name, aliases, role, text(input.email) || null, text(input.color) || null, input.isActive !== false]
  );
  return { member: { name, aliases, role }, ...(await reparseCampaigns()) };
}

/**
 * Says which domain a LinkedIn company name belongs to, or that it is not a
 * company, for everyone at that company in every campaign, including people
 * synced later. dash_v_linkedin_leads applies it immediately.
 */
export async function setCompanyAlias(input, user) {
  const name = text(input.name);
  const key = companyKey(name);
  if (!key) throw badRequest('name is required');
  const notACompany = input.notACompany === true;
  const domain = notACompany ? null : normalizeDomain(input.domain);
  if (!notACompany && !domain) throw badRequest('Give a domain such as mistral.ai, or mark this as not a company');

  await qp(
    `INSERT INTO dash_company_aliases (company_key, company_name, domain, not_a_company, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (company_key) DO UPDATE
       SET company_name = EXCLUDED.company_name, domain = EXCLUDED.domain, not_a_company = EXCLUDED.not_a_company,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, name, domain, notACompany, user.email]
  );
  return { key, name, domain, notACompany };
}

export async function clearCompanyAlias(key) {
  if (!key) throw badRequest('key is required');
  await qp(`DELETE FROM dash_company_aliases WHERE company_key = $1`, [key]);
  return { key, cleared: true };
}
