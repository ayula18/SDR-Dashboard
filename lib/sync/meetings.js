import crypto from 'crypto';
import { qp, upsertRows, withTx } from '../db.js';
import { parseCsvObjects } from '../csv.js';
import { normalizeDomain } from '../outreach/domains.js';
import { isoDay, monthStart, weekStart } from '../outreach/dates.js';

const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** dash_meetings columns, in the order both importers build their rows. */
export const MEETING_COLUMNS = [
  'id', 'company_domain', 'company_raw', 'meeting_date', 'week_start', 'month_start', 'source_of_meeting',
  'channel', 'direction', 'sdr_name', 'qualified', 'points', 'deal_value', 'happened', 'segment',
  'employee_bucket', 'oss_type', 'champion_title', 'senior_champion', 'confidence', 'source_file', 'imported_at',
  'source',
];

const yes = v => /^(yes|y|true|1)$/i.test(String(v ?? '').trim());
const num = v => {
  const s = String(v ?? '').replace(/[^0-9.-]/g, '');
  return s === '' || Number.isNaN(Number(s)) ? null : Number(s);
};

/**
 * The sheet stores "Meeting Date" without a year ("9-Jan") and carries the
 * year in "Month" as DD/MM/YYYY ("01/07/2026" is July). Combine the two, and
 * fall back to the "Week" label ("ws 5 Jan 2026") when the day is unreadable.
 */
export function meetingDate(row) {
  const bucket = String(row['Month'] ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const bucketMonth = bucket ? Number(bucket[2]) - 1 : null;
  const bucketYear = bucket ? Number(bucket[3]) : null;

  const raw = String(row['Meeting Date'] ?? '').trim();
  const dayMonth = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3})/);
  if (dayMonth && MONTH_INDEX[dayMonth[2].toLowerCase()] != null && bucketYear) {
    const month = MONTH_INDEX[dayMonth[2].toLowerCase()];
    let year = bucketYear;
    // A late-December meeting can sit in January's bucket, and vice versa.
    if (bucketMonth === 0 && month === 11) year -= 1;
    if (bucketMonth === 11 && month === 0) year += 1;
    return new Date(Date.UTC(year, month, Number(dayMonth[1])));
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  const week = String(row['Week'] ?? '').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (week && MONTH_INDEX[week[2].toLowerCase()] != null) {
    let year = Number(week[3]);
    if (bucketYear && Math.abs(year - bucketYear) > 1) year = bucketYear; // "ws 5 Jan 2028" typos
    return new Date(Date.UTC(year, MONTH_INDEX[week[2].toLowerCase()], Number(week[1])));
  }

  return bucketYear != null ? new Date(Date.UTC(bucketYear, bucketMonth, 1)) : null;
}

/**
 * Replaces the sheet's rows in dash_meetings with the contents of a "Qualified
 * Meetings 2026 - Happened Audit" CSV export. The sheet is the source of truth
 * for what it covers, so a full replace (in one transaction) is simpler and
 * safer than diffing. Rows booked from Slack (source = 'slack') are untouched.
 */
export async function importMeetingsCsv(text, { sourceFile = 'upload' } = {}) {
  const records = parseCsvObjects(text);
  if (!records.length || !('Company' in records[0])) {
    throw Object.assign(new Error('Expected the Qualified Meetings audit export: no "Company" column found'), { status: 400 });
  }

  const team = await qp(`SELECT name, aliases FROM dash_team`);
  const teamByAlias = new Map();
  for (const t of team) for (const alias of [t.name, ...(t.aliases || [])]) teamByAlias.set(alias.toLowerCase(), t.name);

  const importedAt = new Date();
  const rows = records.map(r => {
    const domain = normalizeDomain(r['Company']);
    const date = meetingDate(r);
    const source = r['Source of Meeting'] || null;
    // "Muni/Kubecon" → Muni; "Referral" → no team member.
    const sourcePerson = teamByAlias.get(String(source ?? '').split(/[/,&+]/)[0].trim().toLowerCase()) || null;
    const id = crypto.createHash('md5')
      .update([domain || r['Company'], date ? isoDay(date) : r['Week'], source, r['Champion']].join('|'))
      .digest('hex');

    return [
      id, domain, r['Company'] || null, date ? isoDay(date) : null, date ? isoDay(weekStart(date)) : null,
      date ? isoDay(monthStart(date)) : null, source, r['Channel'] || null, r['Inbound vs Outbound'] || null,
      sourcePerson, yes(r['Qualified']), num(r['Points']), num(r['Deal Value']),
      r['Meeting Happened? (audited)'] || r['Meeting Happened?'] || null,
      r['Segment Clean'] || r['Segment'] || null,
      String(r['Emp Bucket Clean'] || r['Employee Band'] || '').replace(/^B\d+_/, '') || null,
      r['OSS, Non OSS'] || null, r['Champion - Job Title'] || null, r['Senior Champion?'] || null,
      r['Confidence'] || null, sourceFile, importedAt, 'sheet',
    ];
  });

  const written = await withTx(async client => {
    await client.query(`DELETE FROM dash_meetings WHERE source = 'sheet'`);
    return upsertRows('dash_meetings', MEETING_COLUMNS, rows, { conflict: ['id'], client });
  });

  return {
    rows: records.length,
    imported: written,
    withoutDate: rows.filter(r => !r[3]).length,
    withoutDomain: rows.filter(r => !r[1]).length,
    creditedToTeamMember: rows.filter(r => r[9]).length,
  };
}
