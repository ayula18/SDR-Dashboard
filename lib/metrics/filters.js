import {
  addDays, addMonths, daysBetween, isoDay, monthStart, nextPeriod, periodStart, periodsBetween, toDay, today, weekStart,
} from '../outreach/dates.js';
import { badRequest } from './format.js';

export const RANGE_PRESETS = [
  { value: 'this-week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'last-4-weeks', label: 'Last 4 weeks' },
  { value: 'last-12-weeks', label: 'Last 12 weeks' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3-months', label: 'Last 3 months' },
  { value: 'ytd', label: 'Year to date' },
];

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
 * A date range made of whole weeks (Monday start) or whole months, so it lines
 * up with the weekly/monthly platform numbers, plus the previous range of the
 * same length for week-on-week / month-on-month comparison.
 *
 * While the current range is still running, date-based numbers (replies,
 * meetings, leads loaded) are compared with the same number of elapsed days
 * last period, and whole-period platform volumes are pro-rated by `elapsedShare`.
 */
export function resolveRange(preset, fromParam, toParam, now = today()) {
  let grain = 'week';
  let first;
  let count;
  // since-start is a program page's default: from its first campaign (the caller supplies `from`) to today.
  if (preset === 'since-start' && !fromParam) preset = 'last-4-weeks';

  switch (preset) {
    case 'this-week': first = weekStart(now); count = 1; break;
    case 'last-week': first = addDays(weekStart(now), -7); count = 1; break;
    case 'last-12-weeks': first = addDays(weekStart(now), -77); count = 12; break;
    case 'this-month': grain = 'month'; first = monthStart(now); count = 1; break;
    case 'last-month': grain = 'month'; first = addMonths(monthStart(now), -1); count = 1; break;
    case 'last-3-months': grain = 'month'; first = addMonths(monthStart(now), -2); count = 3; break;
    case 'ytd': grain = 'month'; first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); count = now.getUTCMonth() + 1; break;
    case 'since-start':
    case 'custom': {
      const from = toDay(fromParam);
      const to = toParam ? toDay(toParam) : now;
      if (to < from) throw badRequest('"to" is before "from"');
      // Whole months when the range starts on the 1st and spans a month or more; otherwise whole weeks.
      grain = from.getUTCDate() === 1 && daysBetween(from, to) >= 27 ? 'month' : 'week';
      first = periodStart(grain, from);
      count = periodsBetween(grain, first, to).length;
      break;
    }
    default:
      preset = 'last-4-weeks';
      first = addDays(weekStart(now), -21);
      count = 4;
  }
  if (count < 1 || count > 104) throw badRequest('A range must cover between 1 and 104 periods');

  const current = wholePeriods(grain, first, count, now);
  const previous = wholePeriods(grain, grain === 'month' ? addMonths(first, -count) : addDays(first, -7 * count), count, now);

  let elapsedShare = 1;
  if (current.partial) {
    const elapsed = daysBetween(current.from, current.toExclusive);
    elapsedShare = elapsed / daysBetween(current.from, current.endExclusive);
    const cut = addDays(previous.from, elapsed);
    const end = toDay(previous.endExclusive);
    previous.toExclusive = isoDay(cut < end ? cut : end);
    previous.to = isoDay(addDays(previous.toExclusive, -1));
  }

  return { preset, ...current, elapsedShare, previous };
}

/** Query params → the filter object every metrics function takes. */
export function parseFilters(searchParams) {
  const pick = key => {
    const v = searchParams.get(key);
    return v && v !== 'all' ? v.trim() : null;
  };
  const range = resolveRange(pick('range') || (pick('from') ? 'custom' : 'last-4-weeks'), pick('from'), pick('to'));
  const grain = pick('grain');

  return {
    ...range,
    trendGrain: grain === 'week' || grain === 'month' ? grain : range.grain,
    sdr: pick('sdr'),
    program: pick('program'),
    theme: pick('theme'),
    campaignId: null,
  };
}

export function describeRange(f) {
  return {
    preset: f.preset,
    grain: f.grain,
    from: f.from,
    to: f.to,
    inProgress: f.partial,
    previous: { from: f.previous.from, to: f.previous.to },
    comparison: f.partial
      ? 'Previous period, same number of days so far (platform volumes pro-rated)'
      : 'Previous period of the same length',
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

export const dashStartDate = () => process.env.DASH_START_DATE || '2026-01-05';
