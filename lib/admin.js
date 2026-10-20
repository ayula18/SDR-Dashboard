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

// ── Meetings an SDR states directly (016_dash_meetings_manual.sql) ──────────

const MEETING_SOURCE = 'manual';

/** The campaign must exist and not be excluded, or the attribution would vanish silently. */
async function checkCampaign(campaignId) {
  if (!campaignId) return null;
  const [row] = await qp(`SELECT id FROM dash_v_campaigns WHERE id = $1 AND NOT excluded`, [campaignId]);
  if (!row) throw badRequest(`"${campaignId}" is not a campaign, or it is excluded`);
  return row.id;
}

async function checkSdr(name) {
  if (!name) return null;
  const [member] = await qp(`SELECT name FROM dash_team WHERE name = $1`, [name]);
  if (!member) throw badRequest(`"${name}" is not on the team roster`);
  return member.name;
}

/**
 * Record a meeting the automated sources never saw, or that nobody could
 * attribute. Stored with source 'manual', which no sync job deletes.
 */
export async function addManualMeeting(input, user) {
  const domain = normalizeDomain(text(input.domain));
  if (!domain) throw badRequest('A company domain is required, for example "acme.com"');

  const day = text(input.meetingDate);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw badRequest('meetingDate must be YYYY-MM-DD');
  const when = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(when.getTime())) throw badRequest(`"${day}" is not a date`);
  // A year out is a typo, not a booking.
  if (when.getTime() > Date.now() + 365 * 86_400_000) throw badRequest('That date is more than a year away');

  const campaignId = await checkCampaign(text(input.campaignId));
  const sdr = await checkSdr(text(input.sdrName));

  // One meeting per company per day, however many times the form is submitted.
  const id = `manual:${domain}:${day}`;
  const [existing] = await qp(
    `SELECT id FROM dash_meetings WHERE company_domain = $1 AND meeting_date = $2::date AND NOT (source = $3)`,
    [domain, day, MEETING_SOURCE]
  );

  await qp(
    `INSERT INTO dash_meetings
       (id, company_domain, company_raw, meeting_date, week_start, month_start,
        source_of_meeting, channel, direction, sdr_name, source, campaign_id, created_by, entry_note, imported_at)
     VALUES ($1,$2,$3,$4::date,
             date_trunc('week', $4::date)::date, date_trunc('month', $4::date)::date,
             'Manual entry', $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (id) DO UPDATE
       SET channel = EXCLUDED.channel, direction = EXCLUDED.direction, sdr_name = EXCLUDED.sdr_name,
           campaign_id = EXCLUDED.campaign_id, entry_note = EXCLUDED.entry_note,
           created_by = EXCLUDED.created_by, imported_at = NOW()`,
    [id, domain, text(input.company) || domain, day,
      text(input.channel) || 'SDR', text(input.direction) || 'Outbound', sdr,
      MEETING_SOURCE, campaignId, user?.email || null, text(input.note)]
  );

  return {
    id,
    domain,
    meetingDate: day,
    campaignId,
    sdrName: sdr,
    // Surfaced rather than refused: dash_v_meetings keeps the sheet's row when
    // two sources describe the same company within three days, so a duplicate
    // here does not double-count — but the person should know it was already in.
    alreadyTracked: Boolean(existing),
  };
}

/** Say which campaign earned a meeting, for a booking from ANY source. */
export async function setMeetingCampaign(meetingId, input, user) {
  const [meeting] = await qp(`SELECT id FROM dash_meetings WHERE id = $1`, [meetingId]);
  if (!meeting) throw notFound(`No meeting ${meetingId}`);

  const clearing = input.campaignId === null || text(input.campaignId) === '';
  const campaignId = clearing ? null : await checkCampaign(text(input.campaignId));
  const sdr = input.sdrName === undefined ? undefined : await checkSdr(text(input.sdrName));

  await qp(
    `UPDATE dash_meetings
        SET campaign_id = $2,
            sdr_name = COALESCE($3, sdr_name),
            created_by = $4,
            entry_note = COALESCE($5, entry_note)
      WHERE id = $1`,
    [meetingId, campaignId, sdr ?? null, user?.email || null, text(input.note)]
  );
  return { id: meetingId, campaignId, sdrName: sdr ?? null };
}

/** Remove a manual row. Only manual rows: a synced booking comes back anyway. */
export async function deleteManualMeeting(meetingId) {
  const [row] = await qp(`SELECT id, source FROM dash_meetings WHERE id = $1`, [meetingId]);
  if (!row) throw notFound(`No meeting ${meetingId}`);
  if (row.source !== MEETING_SOURCE) throw badRequest('Only a manually added meeting can be removed here');
  await qp(`DELETE FROM dash_meetings WHERE id = $1 AND source = $2`, [meetingId, MEETING_SOURCE]);
  return { id: meetingId, deleted: true };
}
