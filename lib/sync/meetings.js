import crypto from 'crypto';
import { qp, upsertRows, withTx } from '../db.js';
import { normalizeDomain } from '../outreach/domains.js';
import { isoDay, monthStart, weekStart } from '../outreach/dates.js';
import { readTab, tabTitle } from '../outreach/google-sheets.js';

const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** dash_meetings columns, in the order every meetings job builds its rows. */
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
 * The audit of every meeting booked in 2026, which the team keeps current: Combined
 * QMeeings Booked-2026 (Ayush, 2026-11-08: "this is updated unlike the last one"). It
 * replaced a CSV exported once on 10 Sep, so September to November were missing.
 * Read by the tab's id, which survives the tab being renamed.
 */
export const MEETINGS_SHEET = { id: '1O8LQo-AluQ_5C0VyHhZh1L32QTlycsdz5ERKGO40h1c', gid: '1574114623' };

/** Below this share of what is stored, a read is a broken one (an emptied or cut tab), not deleted meetings. */
const MIN_SHARE_OF_STORED = 0.8;
const REQUIRED_COLUMNS = ['Company', 'Meeting Date', 'Source of Meeting', 'Channel'];

/** A tab's values, header first → one object per filled row, keyed by the header. */
export function sheetRecords(values) {
  const [header = [], ...body] = values || [];
  const names = header.map(h => String(h ?? '').trim());
  const missing = REQUIRED_COLUMNS.filter(c => !names.includes(c));
  if (missing.length) throw new Error(`The meetings sheet has no ${missing.map(c => `"${c}"`).join(', ')} column; left the meetings as they were.`);
  return body
    .filter(row => row.some(cell => String(cell ?? '').trim()))
    .map(row => Object.fromEntries(names.map((name, i) => [name, row[i] ?? ''])));
}

/** Audit rows → dash_meetings rows in MEETING_COLUMNS order. The id is stable while the row's company, date, source and champion stay. */
export function sheetMeetingRows(records, team, { sourceFile, importedAt }) {
  const teamByAlias = new Map();
  for (const t of team) for (const alias of [t.name, ...(t.aliases || [])]) teamByAlias.set(alias.toLowerCase(), t.name);

  const rows = new Map();
  for (const r of records) {
    const domain = normalizeDomain(r['Company']);
    const date = meetingDate(r);
    const source = r['Source of Meeting'] || null;
    // "Muni/Kubecon" → Muni; "Referral" → no team member.
    const sourcePerson = teamByAlias.get(String(source ?? '').split(/[/,&+]/)[0].trim().toLowerCase()) || null;
    const id = crypto.createHash('md5')
      .update([domain || r['Company'], date ? isoDay(date) : r['Week'], source, r['Champion']].join('|'))
      .digest('hex');

    // The same row twice is one meeting.
    rows.set(id, [
      id, domain, r['Company'] || null, date ? isoDay(date) : null, date ? isoDay(weekStart(date)) : null,
      date ? isoDay(monthStart(date)) : null, source, r['Channel'] || null, r['Inbound vs Outbound'] || null,
      sourcePerson, yes(r['Qualified']), num(r['Points']), num(r['Deal Value']),
      r['Meeting Happened? (audited)'] || r['Meeting Happened?'] || null,
      r['Segment Clean'] || r['Segment'] || null,
      String(r['Emp Bucket Clean'] || r['Employee Band'] || '').replace(/^B\d+_/, '') || null,
      r['OSS, Non OSS'] || null, r['Champion - Job Title'] || null, r['Senior Champion?'] || null,
      r['Confidence'] || null, sourceFile, importedAt, 'sheet',
    ]);
  }
  return [...rows.values()];
}

/**
 * Reads the audit sheet and makes the sheet's rows in dash_meetings match it: no
 * write to the sheet, two Sheets reads (the tab's name, then its values). Rows are
 * updated in place, so what other jobs wrote on them (whether it was held) stays,
 * and only rows the sheet no longer has are removed. An SDR's own word on a row
 * (stated_sdr, campaign_id, which no sync writes) moves to the row that replaces it
 * when the sheet edits that row's date or champion, which changes its id.
 */
export async function syncMeetingsSheet() {
  const title = await tabTitle(MEETINGS_SHEET.id, MEETINGS_SHEET.gid);
  const records = sheetRecords(await readTab(MEETINGS_SHEET.id, title));
  const [team, [{ stored }]] = await Promise.all([
    qp(`SELECT name, aliases FROM dash_team`),
    qp(`SELECT count(*)::int AS stored FROM dash_meetings WHERE source = 'sheet'`),
  ]);
  const rows = sheetMeetingRows(records, team, { sourceFile: title, importedAt: new Date() });
  if (rows.length < stored * MIN_SHARE_OF_STORED) {
    throw new Error(`The meetings sheet read ${rows.length} rows against ${stored} stored; left the meetings as they were. Check the tab.`);
  }

  const ids = rows.map(r => r[0]);
  const { written, carried, removed } = await withTx(async client => {
    const count = await upsertRows('dash_meetings', MEETING_COLUMNS, rows, { conflict: ['id'], client });
    const moved = await client.query(
      `UPDATE dash_meetings n
          SET stated_sdr = COALESCE(n.stated_sdr, o.stated_sdr), campaign_id = COALESCE(n.campaign_id, o.campaign_id),
              stated_channel = COALESCE(n.stated_channel, o.stated_channel), stated_not_sdr = n.stated_not_sdr OR o.stated_not_sdr
         FROM dash_meetings o
        WHERE o.source = 'sheet' AND NOT (o.id = ANY($1::text[]))
          AND (o.stated_sdr IS NOT NULL OR o.campaign_id IS NOT NULL OR o.stated_channel IS NOT NULL OR o.stated_not_sdr)
          AND n.source = 'sheet' AND n.id = ANY($1::text[]) AND n.company_domain = o.company_domain
          AND abs(n.meeting_date - o.meeting_date) <= 7`,
      [ids]
    );
    const gone = await client.query(`DELETE FROM dash_meetings WHERE source = 'sheet' AND NOT (id = ANY($1::text[]))`, [ids]);
    return { written: count, carried: moved.rowCount, removed: gone.rowCount };
  });

  const dates = rows.map(r => r[3]).filter(Boolean).sort();
  return {
    tab: title,
    rows: rows.length,
    written,
    removed,
    statementsCarried: carried,
    withoutDate: rows.filter(r => !r[3]).length,
    withoutDomain: rows.filter(r => !r[1]).length,
    latestMeeting: dates.at(-1) || null,
  };
}
