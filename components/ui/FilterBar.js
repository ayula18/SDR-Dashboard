'use client';

import { useState } from 'react';
import { useDashboard } from '@/lib/client/dashboard-context';
import { fmtDateRange } from '@/lib/client/format';
import { RANGE_OPTIONS, useFilters } from '@/lib/client/use-filters';

const CUSTOM = 'custom';
const DAY_MS = 86_400_000;
// A range can cover at most 104 whole weeks.
const MAX_DAYS = 728;

const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * A start and end date with Apply. Like the presets, the range is counted in
 * whole weeks (whole months when it starts on the 1st), because email and
 * LinkedIn volumes are stored that way; the dates line shows where it landed.
 */
function CustomRange({ initialFrom, initialTo, applied, onApply, onCancel }) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const today = localToday();
  let problem = null;
  if (from && to && from > to) problem = 'The start date is after the end date.';
  else if (from && to && (Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_DAYS) problem = 'Pick two years or less.';
  const ready = Boolean(from && to) && !problem && !(applied && from === initialFrom && to === initialTo);

  return (
    <form className="custom-range" aria-label="Custom date range" onSubmit={e => { e.preventDefault(); if (ready) onApply(from, to); }}>
      <input type="date" className="date-input" aria-label="Start date" value={from} max={to || today} onChange={e => setFrom(e.target.value)} />
      <span className="custom-range-sep">to</span>
      <input type="date" className="date-input" aria-label="End date" value={to} min={from || undefined} max={today} onChange={e => setTo(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={!ready}>Apply</button>
      {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      {problem && <span className="custom-range-error" role="alert">{problem}</span>}
    </form>
  );
}

/**
 * The single filter row above a page's content. Date range first, then trend
 * grain, then who and what. The selection lives in the URL, and everything
 * below re-renders against the same slice. `leading` goes before the date
 * range; `extraRanges` adds page-specific range options, such as a program's
 * "Since start".
 */
export default function FilterBar({ range, hide = [], defaultRange = 'last-4-weeks', extraRanges = [], showGrain = true, leading, children }) {
  const { meta } = useDashboard();
  const { values, setParams } = useFilters({ defaultRange });
  const [picking, setPicking] = useState(false);
  const custom = Boolean(values.from);
  const grain = values.grain || range?.grain || 'week';
  const filtered = ['sdr', 'program', 'theme', 'from', 'grain'].some(k => values[k] && !hide.includes(k)) || values.range !== defaultRange;
  // Custom dates round out to whole weeks or months; say so when that moved them.
  const rounded = custom && range && (range.from !== values.from || (values.to && range.to !== values.to));

  const pickRange = value => {
    if (value === CUSTOM) {
      setPicking(true);
      return;
    }
    setPicking(false);
    setParams({ range: value === defaultRange ? null : value, from: null, to: null });
  };

  return (
    <div className="filters" role="group" aria-label="Filters">
      {leading}

      <select
        aria-label="Date range"
        className="select-trigger"
        value={custom || picking ? CUSTOM : values.range}
        onChange={e => pickRange(e.target.value)}
      >
        {[...extraRanges, ...RANGE_OPTIONS].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value={CUSTOM}>Custom range…</option>
      </select>

      {(custom || picking) && (
        <CustomRange
          key={picking ? 'picking' : `${values.from}|${values.to}`}
          initialFrom={picking ? range?.from || '' : values.from}
          initialTo={picking ? range?.to || localToday() : values.to || localToday()}
          applied={custom && !picking}
          onApply={(from, to) => {
            setPicking(false);
            setParams({ range: null, from, to });
          }}
          onCancel={picking ? () => setPicking(false) : null}
        />
      )}

      {showGrain && (
        <div className="segmented" role="group" aria-label="Show trends">
          {[['week', 'Weekly'], ['month', 'Monthly']].map(([value, text]) => (
            <button key={value} type="button" aria-pressed={grain === value} onClick={() => setParams({ grain: value })}>
              {text}
            </button>
          ))}
        </div>
      )}

      {!hide.includes('sdr') && (
        <select aria-label="SDR" className="select-trigger" value={values.sdr} onChange={e => setParams({ sdr: e.target.value })}>
          <option value="">All SDRs</option>
          {(meta?.sdrs || []).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      )}

      {!hide.includes('program') && (
        <select aria-label="Program" className="select-trigger" value={values.program} onChange={e => setParams({ program: e.target.value })}>
          <option value="">All programs</option>
          {(meta?.programs || []).map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      )}

      {!hide.includes('theme') && (
        <select aria-label="Message angle" className="select-trigger" value={values.theme} onChange={e => setParams({ theme: e.target.value })}>
          <option value="">All message angles</option>
          {(meta?.themes || []).map(t => <option key={t.theme} value={t.theme}>{t.theme}</option>)}
        </select>
      )}

      {children}

      {filtered && (
        <button
          type="button"
          className="filters-reset"
          onClick={() => {
            setPicking(false);
            setParams({ range: null, from: null, to: null, grain: null, sdr: null, program: null, theme: null, channel: null });
          }}
        >
          Reset filters
        </button>
      )}

      {range && (
        <span className="filters-dates">
          {range.preset === 'since-start'
            ? `${fmtDateRange(range.from, range.to)}, since the first campaign`
            : `${fmtDateRange(range.from, range.to)}${range.inProgress ? ' so far' : ''}${rounded ? `, in whole ${range.rangeGrain === 'month' ? 'months' : 'weeks'}` : ''}, compared with ${fmtDateRange(range.previous.from, range.previous.to)}`}
        </span>
      )}
    </div>
  );
}
