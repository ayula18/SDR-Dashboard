/**
 * Calendar helpers. UTC and date-only throughout: Instantly reports analytics
 * by calendar date, and weeks start on Monday to match the allocation sheet
 * ("ws 5 Jan 2026").
 */

const DAY_MS = 86_400_000;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** UTC midnight, from a Date or a 'YYYY-MM-DD…' string. */
export function toDay(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw Object.assign(new Error(`Not a date: ${value}`), { status: 400 });
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export const isoDay = d => toDay(d).toISOString().slice(0, 10);
export const today = () => toDay(new Date());
export const addDays = (d, n) => new Date(toDay(d).getTime() + n * DAY_MS);
export const daysBetween = (a, b) => Math.round((toDay(b) - toDay(a)) / DAY_MS);

export function addMonths(d, n) {
  const x = toDay(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1));
}

export function weekStart(d) {
  const x = toDay(d);
  return addDays(x, -((x.getUTCDay() + 6) % 7));
}

export function monthStart(d) {
  const x = toDay(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1));
}

export const periodStart = (grain, d) => (grain === 'month' ? monthStart(d) : weekStart(d));
export const nextPeriod = (grain, d) => (grain === 'month' ? addMonths(d, 1) : addDays(weekStart(d), 7));

/** Inclusive last day of the period that starts at `start`. */
export const periodEnd = (grain, start) => addDays(nextPeriod(grain, periodStart(grain, start)), -1);

/** ISO starts of every period overlapping [from, to], oldest first. */
export function periodsBetween(grain, from, to) {
  const out = [];
  const end = toDay(to);
  for (let d = periodStart(grain, from); d <= end; d = nextPeriod(grain, d)) out.push(isoDay(d));
  return out;
}

export function isoWeek(d) {
  const x = toDay(d);
  const thursday = addDays(x, 3 - ((x.getUTCDay() + 6) % 7));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.ceil(((thursday - yearStart) / DAY_MS + 1) / 7);
}

export function periodLabel(grain, iso) {
  const d = toDay(iso);
  if (grain === 'month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `W${isoWeek(d)} · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
