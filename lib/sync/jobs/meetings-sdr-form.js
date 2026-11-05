import { qp, upsertRows, withTx } from '../../db.js';
import { sdrFormDeals } from '../../outreach/hubspot.js';
import { isoDay, monthStart, weekStart } from '../../outreach/dates.js';
import { formRow, meetingsOnlyOnForm } from '../../outreach/sdr-form.js';
import { MEETING_COLUMNS } from '../meetings.js';

const COLUMNS = ['deal_id', 'company_domain', 'company_name', 'meeting_date', 'owner_raw', 'sdr', 'not_sdr', 'source_of_meeting', 'booked_on', 'synced_at'];

/** Syncs fire every few minutes and the form changes when a meeting is booked, so a few reads a day will do. */
const FRESH_FOR_MS = 3 * 3_600_000;
/** Below this share of what is stored, a read is treated as a broken one rather than deleted deals. */
const MIN_SHARE_OF_STORED = 0.8;

const asMeeting = (row, importedAt) => {
  const date = new Date(`${row.meetingDate}T00:00:00Z`);
  return [
    `form:${row.dealId}`, row.companyDomain, row.companyName || row.companyDomain, row.meetingDate,
    isoDay(weekStart(date)), isoDay(monthStart(date)),
    row.ownerRaw, 'SDR', 'Outbound',
    row.sdr, null, null, null,   // qualified, points and deal value: the audit sheet decides those
    null,                        // happened: meetings-evidence decides
    null, null, null, null, null, null,
    'hubspot deal form', importedAt, 'form',
  ];
};

/**
 * The first word on who booked a meeting, read from the SDR form on HubSpot deals.
 * Writes dash_sdr_form, which dash_v_meetings reads, and gives a form row naming an
 * SDR its own meeting where no other source has one. A row a later source picks up
 * is dropped here, on the next run, so a booking is never held twice.
 */
export const job = {
  label: 'Meetings booked (the SDR form on HubSpot deals)',
  weight: 1,
  minSliceMs: 15_000,
  maxAgeHours: 36,

  async run({ mode } = {}) {
    const [{ stored, last }] = await qp(`SELECT count(*)::int AS stored, max(synced_at) AS last FROM dash_sdr_form`);
    if (mode !== 'full' && last && Date.now() - new Date(last).getTime() < FRESH_FOR_MS) {
      return { fresh: true };
    }

    const [deals, team, aliases] = await Promise.all([
      sdrFormDeals(),
      qp(`SELECT name, aliases FROM dash_team`),
      qp(`SELECT domain, canonical_domain FROM dash_company_domains`),
    ]);
    if (deals.length < stored * MIN_SHARE_OF_STORED) {
      throw new Error(`HubSpot returned ${deals.length} form deals against ${stored} stored; left the table as it was.`);
    }
    const canonical = new Map(aliases.map(a => [a.domain, a.canonical_domain]));
    const rows = deals.map(deal => formRow(deal, { team, canonical })).filter(Boolean);

    const others = await qp(`
      SELECT COALESCE(cd.canonical_domain, m.company_domain) AS domain, m.meeting_date::text AS date
        FROM dash_meetings m
        LEFT JOIN dash_company_domains cd ON cd.domain = m.company_domain
       WHERE m.source <> 'form' AND m.superseded_by IS NULL AND m.company_domain IS NOT NULL`);
    const onlyOnForm = meetingsOnlyOnForm(rows, others);

    const now = new Date();
    await withTx(async client => {
      await upsertRows('dash_sdr_form', COLUMNS, rows.map(r => [
        r.dealId, r.companyDomain, r.companyName, r.meetingDate, r.ownerRaw, r.sdr, r.notSdr, r.sourceOfMeeting, r.bookedOn, now,
      ]), { conflict: ['deal_id'], client });
      await qp(`DELETE FROM dash_sdr_form WHERE NOT (deal_id = ANY($1::text[]))`, [rows.map(r => r.dealId)], client);
      const keep = onlyOnForm.map(r => `form:${r.dealId}`);
      await qp(`DELETE FROM dash_meetings WHERE source = 'form' AND NOT (id = ANY($1::text[]))`, [keep], client);
      if (keep.length) await upsertRows('dash_meetings', MEETING_COLUMNS, onlyOnForm.map(r => asMeeting(r, now)), { conflict: ['id'], client });
    });

    return {
      deals: deals.length,
      namingAnSdr: rows.filter(r => r.sdr).length,
      notAnSdr: rows.filter(r => r.notSdr).length,
      meetingsOnlyOnForm: onlyOnForm.length,
    };
  },
};
