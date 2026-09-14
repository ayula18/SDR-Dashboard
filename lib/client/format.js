const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DASH = '–';

const oneDecimal = n => String(Math.round(n * 10) / 10);
const isMissing = v => v == null || v === '' || Number.isNaN(Number(v));

/** 1,284 */
export const fmtInt = v => (isMissing(v) ? DASH : integer.format(Number(v)));

/** 1,284 · 12.9K · 4.2M: compact only once a full number gets long. */
export function fmtCompact(v) {
  if (isMissing(v)) return DASH;
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return `${oneDecimal(n / 1e6)}M`;
  if (Math.abs(n) >= 1e4) return `${oneDecimal(n / 1e3)}K`;
  return integer.format(n);
}

export const fmtPct = (v, digits = 1) => (isMissing(v) ? DASH : `${Number(v).toFixed(digits)}%`);

export function fmtMoney(v) {
  if (isMissing(v)) return DASH;
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return `$${oneDecimal(n / 1e6)}M`;
  if (Math.abs(n) >= 1e3) return `$${integer.format(Math.round(n / 1e3))}K`;
  return `$${integer.format(n)}`;
}

/** +11.2% · −7% (whole numbers once past 100%) */
export function fmtChange(pct) {
  if (isMissing(pct)) return DASH;
  const rounded = Math.abs(pct) >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export const fmtPoints = pts => (isMissing(pts) ? DASH : `${pts > 0 ? '+' : ''}${pts} pts`);

function toDate(value) {
  if (value instanceof Date) return value;
  const s = String(value);
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
}

/** 9 Sep, or 9 Sep 2026 */
export function fmtDate(value, { year = false } = {}) {
  if (!value) return DASH;
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return DASH;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

export function fmtDateRange(from, to) {
  if (!from || !to) return '';
  const a = toDate(from);
  const b = toDate(to);
  return `${fmtDate(a, { year: a.getUTCFullYear() !== b.getUTCFullYear() })} – ${fmtDate(b, { year: true })}`;
}

/** Axis and tooltip labels for a period start: "31 Aug" / "Week of 31 Aug", "Aug 2026". */
export function fmtPeriod(grain, iso, { long = false } = {}) {
  if (!iso) return DASH;
  const d = toDate(iso);
  if (grain === 'month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${long ? 'Week of ' : ''}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** just now · 12 min ago · 3 h ago · 2 days ago */
export function fmtRelative(value, now = Date.now()) {
  if (!value) return 'never';
  const seconds = Math.round((now - toDate(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  const days = Math.round(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** "vs 20 Jul – 13 Aug 2026" for a describeRange() payload. */
export const comparisonLabel = range =>
  (range?.previous ? `vs ${fmtDateRange(range.previous.from, range.previous.to)}` : '');

/** What each reply verdict means to a reader, and how it should look. */
export const VERDICTS = {
  interested: { label: 'Interested', tone: 'good' },
  deferred: { label: 'Not now', tone: 'neutral' },
  not_the_person: { label: 'Wrong person', tone: 'neutral' },
  unknown: { label: 'Replied', tone: 'neutral' },
  off_topic: { label: 'Off-topic', tone: 'neutral' },
  declined: { label: 'Not interested', tone: 'bad' },
  unsubscribed: { label: 'Unsubscribed', tone: 'bad' },
  auto: { label: 'Auto-reply', tone: 'neutral' },
};

export const safeDecode = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: [{ label, key, csv?(row) }] */
export function toCsv(columns, rows) {
  const header = columns.map(c => csvCell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => csvCell(c.csv ? c.csv(r) : r[c.key])).join(','));
  return [header, ...body].join('\n');
}

export function downloadCsv(filename, columns, rows) {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
