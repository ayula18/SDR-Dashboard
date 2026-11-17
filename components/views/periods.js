'use client';

import { useEffect, useRef } from 'react';
import { fmtDateRange, fmtDateTime, fmtInt, fmtPeriod } from '@/lib/client/format';
import { useDashboard } from '@/lib/client/dashboard-context';
import { useFilters } from '@/lib/client/use-filters';
import { MONTHS } from '@/lib/outreach/dates';
import { RangePicker } from '../ui/FilterBar';
import MultiSelect from '../ui/MultiSelect';
import { DEFS } from './definitions';
import { ComparisonButtons, FUNNEL, RATES } from './funnel';

/**
 * What the period pages share, the Overview and SDR Detailed - Metrics: a column per working day,
 * week or month (`periodColumns` on the server, `/api/metrics/funnel`), one set of
 * controls above them all, and the same headings, shading and wording, so the two pages
 * read alike and cannot drift apart.
 */

/** Who a channel's numbers add up: SDRs on Email and LinkedIn, the SDRs and the callers on Call and All. */
export const PEOPLE = {
  all: { one: 'Person', many: 'SDRs and callers' },
  email: { one: 'SDR', many: 'SDRs' },
  linkedin: { one: 'SDR', many: 'SDRs' },
  call: { one: 'Person', many: 'SDRs and callers' },
};
const GRAINS = ['day', 'week', 'month'];
const UNIT = { day: 'working day', week: 'week', month: 'month' };
// What the range menu calls "no dates picked": the server's last full periods (WINDOW in lib/metrics/funnel.js).
const LATEST = { day: 'Last 20 working days', week: 'Last 12 full weeks', month: 'Last 12 full months' };
const RUNNING = ['today', 'wtd', 'mtd'];

/** A channel's rows: the counts, then the rates. */
export const channelMetrics = channel => [...FUNNEL[channel].filter(m => m.board), ...RATES[channel]];

export const andList = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** "8–12 Jul", "28 Jun – 3 Jul", "17 Nov". */
export function span(from, to) {
  const day = iso => `${Number(iso.slice(8, 10))}`;
  const month = iso => MONTHS[Number(iso.slice(5, 7)) - 1];
  if (from === to) return `${day(from)} ${month(from)}`;
  return month(from) === month(to) ? `${day(from)}–${day(to)} ${month(to)}` : `${day(from)} ${month(from)} – ${day(to)} ${month(to)}`;
}

/** A column's heading and what hovering it says; `readAt` is when the channel was last read. */
export function heading(grain, c, readAt) {
  if (c.kind === 'today') return { label: 'Today (so far)', hint: `${fmtPeriod('day', c.period, { long: true })} so far: what was read by ${fmtDateTime(readAt)}, your time. Days are UTC, so today ends at 05:30 IST.` };
  if (c.kind === 'wtd') return { label: `WTD (${span(c.from, c.to)})`, hint: 'Week to date: this week so far, still running' };
  if (c.kind === 'mtd') return { label: `MTD (${span(c.from, c.to)})`, hint: 'Month to date: this month so far, still running' };
  const name = fmtPeriod(grain, c.period, { long: true });
  if (c.kind === 'part') return { label: span(c.from, c.to), hint: `${name}, only the days inside the dates picked` };
  return { label: fmtPeriod(grain, c.period, { long: grain === 'day' }), hint: name };
}

/** A column in words, for the list a count opens: "Week of 6 Jul, 8–12 Jul", "Month to date, 1–17 Nov". */
export function columnName(grain, c) {
  if (c.kind === 'today') return `Today so far, ${span(c.from, c.to)}`;
  if (c.kind === 'wtd' || c.kind === 'mtd') return `${c.kind === 'wtd' ? 'Week' : 'Month'} to date, ${span(c.from, c.to)}`;
  const name = fmtPeriod(grain, c.period, { long: true });
  return c.kind === 'part' ? `${name}, ${span(c.from, c.to)}` : name;
}

/** Which columns are whole periods (on the colour scale), periods (whole or cut short) and the running one. */
export function columnKinds(columns) {
  const at = test => columns.flatMap((c, i) => (test(c) ? [i] : []));
  return {
    whole: at(c => c.kind === 'full'),
    periods: at(c => c.kind === 'full' || c.kind === 'part'),
    running: columns.findIndex(c => RUNNING.includes(c.kind)),
  };
}

/**
 * One row's colour scale, as an Excel colour scale does it (Ayush, 2026-11-10: "a heatmap
 * sort of with soft pastel colors just like our excel"): its lowest value lightest, its
 * highest deepest. Rows never share a scale, since emails, counts and rates are different
 * sizes. Only whole periods are on the scale: a period the dates cut short, or today, WTD
 * or MTD still running, would read as a bad one. Nothing to tell apart, or a missing rate,
 * stays unshaded.
 */
export function shadeScale(values) {
  const known = values.filter(v => v != null);
  const min = Math.min(...known);
  const max = Math.max(...known);
  return v => (v == null || !(max > min) ? undefined : { '--heat': ((v - min) / (max - min)).toFixed(3) });
}

/** "a column per week: the last 12 full weeks, oldest on the left. Then WTD, …", the columns in words. */
export function columnsPhrase({ grain, columns, picked, readAt }) {
  const unit = UNIT[grain];
  const { periods, running } = columnKinds(columns);
  const shown = periods.map(i => columns[i]);
  let text = `a column per ${unit}`;
  if (!picked) text += `: the last ${fmtInt(shown.length)} full ${unit}s, oldest on the left.`;
  else if (shown.length) text += `, ${fmtDateRange(shown[0].from, shown[shown.length - 1].to)}, oldest on the left.`;
  else text += '. No whole one has ended in these dates yet.';
  if (shown.some(c => c.kind === 'part')) text += ` A ${unit} the dates cut short counts only its days inside them.`;
  if (running >= 0) {
    const phrase = { today: 'today so far', wtd: 'WTD, this week so far', mtd: 'MTD, this month so far' }[columns[running].kind];
    text += ` Then ${phrase}, unshaded while it runs${readAt ? `, as read by ${fmtDateTime(readAt)}` : ''}.`;
  }
  if (grain === 'day') text += ` ${DEFS.workingDays}`;
  return text;
}

/**
 * The page's one set of controls, shared by every table on it (Ayush, 2026-11-17: "i want
 * to see same data across all 3 cards so that i can compare. so give me a main buttons
 * only"), kept in the URL so a link opens the same view: `view`, and `sdr` and the dates
 * under the names every page uses. `defaultGrain` is the view with nothing in the URL.
 */
export function usePageSettings(defaultGrain = 'day') {
  const { get, setParams } = useFilters();
  const view = get('view');
  const grain = GRAINS.includes(view) ? view : defaultGrain;
  const sdr = get('sdr');
  const dates = { range: get('range') || null, from: get('from') || null, to: get('to') || null };
  return {
    grain,
    sdr,
    dates,
    picked: Boolean(dates.from || dates.range),
    setGrain: next => setParams({ view: next === defaultGrain ? null : next }),
    setSdr: names => setParams({ sdr: names.join(',') }),
    setDates: ({ range, from, to }) => setParams({ range, from, to }),
  };
}

/** What `/api/metrics/funnel` is asked for one channel's table under these settings. */
export const funnelQuery = ({ grain, sdr, dates }, channel) => ({
  grain,
  channel,
  toDate: 1,
  ...(sdr ? { sdr } : {}),
  ...(dates.from ? { from: dates.from, to: dates.to } : dates.range ? { range: dates.range } : {}),
});

/** DoD / WoW / MoM, who, and dates, once, above the tables ("DOD WOW MOM and then, sdr picking option and then custom range and thats it"). */
export function PageControls({ settings }) {
  const { meta } = useDashboard();
  return (
    <div className="filters" role="group" aria-label="What every table shows">
      <ComparisonButtons value={settings.grain} onChange={settings.setGrain} />
      <MultiSelect
        label="People"
        allLabel="All SDRs"
        options={(meta?.sdrs || []).map(s => s.name)}
        value={settings.sdr ? settings.sdr.split(',').filter(Boolean) : []}
        onChange={settings.setSdr}
      />
      <RangePicker value={settings.dates} onChange={settings.setDates} emptyLabel={LATEST[settings.grain]} />
    </div>
  );
}

/** Many columns run wider than the card: open on the latest, the names column held in place. */
export function useScrollToLatest(data) {
  const scroller = useRef(null);
  useEffect(() => {
    const el = scroller.current?.querySelector('.dt-scroll');
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data]);
  return scroller;
}
