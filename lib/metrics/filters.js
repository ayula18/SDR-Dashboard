import {
  addDays, addMonths, daysBetween, isoDay, monthStart, nextPeriod, periodStart, periodsBetween, toDay, today, weekStart,
} from '../outreach/dates.js';
import { badRequest } from './format.js';

export const RANGE_PRESETS = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this-week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'last-4-weeks', label: 'Last 4 weeks' },
  { value: 'last-12-weeks', label: 'Last 12 weeks' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3-months', label: 'Last 3 months' },
  { value: 'ytd', label: 'Year to date' },
];

const MAX_RANGE_DAYS = 731;

/** `count` whole periods starting at `first`, clipped to today. */
function wholePeriods(grain, first, count, now) {
  const periods = [];
  let cursor = first;
  for (let i = 0; i < count; i++) {
    periods.push(isoDay(cursor));
    cursor = nextPeriod(grain, cursor);
  }
  const tomorrow = addDays(now, 1);
  const toExclusive = cursor < tomorrow ? cursor : tomorrow;
  return {
    grain,
    periods,
    from: periods[0],
    to: isoDay(addDays(toExclusive, -1)),
    toExclusive: isoDay(toExclusive),
    endExclusive: isoDay(cursor),
    partial: cursor > tomorrow,
  };
}

/**
 * A date range of whole days, weeks (Monday start) or months, each of which the
 * platform numbers are stored by, plus the previous range of the same length.
 * A custom range is exactly the days picked; it used to round out to whole weeks,
 * so a three-day pick counted about ten, until days were stored (029).
 *
 * While the current range is still running, date-based numbers (replies,
 * meetings, leads loaded) are compared with the same number of elapsed days
 * last period, and whole-period platform volumes are pro-rated by `elapsedShare`.
 */
export function resolveRange(preset, fromParam, toParam, now = today()) {
  let grain = 'week';
  let first;
  let count;
  // What "previous" means for this preset. Every range compares against the one
  // of equal length immediately before it — except Year to date, which is
  // anchored to a calendar year and so compares against the SAME window a year
  // earlier. Taking the ten months before January put YTD 2026 against March to
  // December 2025: a different part of the year, including the busy December it
  // should exclude and missing the January it should include. It understated
  // growth by about a third (leads read +208% when year on year was +275%).
  let compareFrom = null;
  // since-start is a program page's default: from its first campaign (the caller supplies `from`) to today.
  if (preset === 'since-start' && !fromParam) preset = 'last-4-weeks';

  switch (preset) {
    case 'yesterday': grain = 'day'; first = addDays(now, -1); count = 1; break;
    case 'this-week': first = weekStart(now); count = 1; break;
    case 'last-week': first = addDays(weekStart(now), -7); count = 1; break;
    case 'last-12-weeks': first = addDays(weekStart(now), -77); count = 12; break;
    case 'this-month': grain = 'month'; first = monthStart(now); count = 1; break;
    case 'last-month': grain = 'month'; first = addMonths(monthStart(now), -1); count = 1; break;
    case 'last-3-months': grain = 'month'; first = addMonths(monthStart(now), -2); count = 3; break;
    case 'ytd':
      grain = 'month';
      first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      count = now.getUTCMonth() + 1;
      compareFrom = addMonths(first, -12);
      break;
    case 'since-start': {
      const from = toDay(fromParam);
      const to = toParam ? toDay(toParam) : now;
      if (to < from) throw badRequest('"to" is before "from"');
      // Whole months when the range starts on the 1st and spans a month or more; otherwise whole weeks.
      grain = from.getUTCDate() === 1 && daysBetween(from, to) >= 27 ? 'month' : 'week';
      first = periodStart(grain, from);
      count = periodsBetween(grain, first, to).length;
      break;
    }
    case 'custom': {
      const from = toDay(fromParam);
      const to = toParam ? toDay(toParam) : now;
      if (to < from) throw badRequest('"to" is before "from"');
      grain = 'day';
      first = from;
      count = daysBetween(from, to) + 1;
      break;
    }
    default:
      preset = 'last-4-weeks';
      first = addDays(weekStart(now), -21);
      count = 4;
  }
  if (count < 1 || count > (grain === 'day' ? MAX_RANGE_DAYS : 104)) throw badRequest('A range can be at most two years');

  const current = wholePeriods(grain, first, count, now);
  const previous = wholePeriods(
    grain,
    compareFrom ?? (grain === 'month' ? addMonths(first, -count) : addDays(first, -(grain === 'day' ? 1 : 7) * count)),
    count,
    now,
  );

  let elapsedShare = 1;
  if (current.partial) {
    const elapsed = daysBetween(current.from, current.toExclusive);
    elapsedShare = elapsed / daysBetween(current.from, current.endExclusive);
    const cut = addDays(previous.from, elapsed);
    const end = toDay(previous.endExclusive);
    previous.toExclusive = isoDay(cut < end ? cut : end);
    previous.to = isoDay(addDays(previous.toExclusive, -1));
  }

  return { preset, ...current, elapsedShare, previous, comparesToLastYear: compareFrom !== null };
}

/**
 * Past about four months a weekly chart is a row of bars nobody can read, so a
 * long range buckets by month instead. This used to be the program route
 * quietly setting `grain=month` in the URL on your behalf, next to a
 * weekly/monthly toggle that could then contradict the dates beside it.
 */
const LONG_RANGE_DAYS = 120;

/** How the trend charts are bucketed: the range decides, and nothing overrides it. */
function trendGrainFor(range) {
  if (range.grain === 'month') return 'month';
  return daysBetween(range.from, range.to) > LONG_RANGE_DAYS ? 'month' : 'week';
}

/** Query params → the filter object every metrics function takes. */
export function parseFilters(searchParams) {
  const pick = key => {
    const v = searchParams.get(key);
    return v && v !== 'all' ? v.trim() : null;
  };
  // Filters that accept several values at once arrive comma-separated: "Akhil,Dheeraj".
  const pickList = key => {
    const value = pick(key);
    const items = value ? [...new Set(value.split(',').map(v => v.trim()).filter(Boolean))] : [];
    return items.length ? items : null;
  };
  const range = resolveRange(pick('range') || (pick('from') ? 'custom' : 'last-4-weeks'), pick('from'), pick('to'));

  return {
    ...range,
    trendGrain: trendGrainFor(range),
    sdr: pickList('sdr'),
    program: pick('program'),
    theme: pick('theme'),
    campaignId: null,
  };
}

export function describeRange(f) {
  return {
    preset: f.preset,
    // How the trend charts are bucketed, so a page labels its charts by what the data was built with.
    grain: f.trendGrain || f.grain,
    // The days, weeks or months the range itself is counted in.
    rangeGrain: f.grain,
    from: f.from,
    to: f.to,
    inProgress: f.partial,
    previous: { from: f.previous.from, to: f.previous.to },
    comparison: f.comparesToLastYear
      ? (f.partial
        ? 'Same window last year, to the same day (platform volumes pro-rated)'
        : 'Same window last year')
      : (f.partial
        ? 'Previous period, same number of days so far (platform volumes pro-rated)'
        : 'Previous period of the same length'),
    filters: { sdr: f.sdr, program: f.program, theme: f.theme },
  };
}

/** The last `count` period starts of `grain`, ending with the period that contains `end`. */
export function trailingPeriods(grain, end, count) {
  const out = [];
  let cursor = periodStart(grain, end);
  for (let i = 0; i < count; i++) {
    out.unshift(isoDay(cursor));
    cursor = grain === 'month' ? addMonths(cursor, -1) : addDays(cursor, -7);
  }
  return out;
}

/**
 * The last `count` periods to have ended before `asOf`, oldest first: day on day,
 * week on week and month on month compare last full periods only (Ayush, 2026-11-06).
 * Days are working days. Weekend sends are under a tenth of a weekday's, so
 * comparing Monday with Sunday would say nothing but "it was the weekend".
 */
export function fullPeriods(grain, count, asOf = today()) {
  if (grain !== 'day') return trailingPeriods(grain, addDays(periodStart(grain, asOf), -1), count);
  const days = [];
  for (let d = addDays(asOf, -1); days.length < count; d = addDays(d, -1)) {
    if (d.getUTCDay() % 6 !== 0) days.unshift(isoDay(d));
  }
  return days;
}

export const dashStartDate = () => process.env.DASH_START_DATE || '2026-01-05';
