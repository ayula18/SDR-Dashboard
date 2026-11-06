'use client';

import { useState } from 'react';
import { useDashboard } from '@/lib/client/dashboard-context';
import { fmtDateRange } from '@/lib/client/format';
import { RANGE_OPTIONS, useFilters } from '@/lib/client/use-filters';
import MultiSelect from './MultiSelect';

const CUSTOM = 'custom';
const DAY_MS = 86_400_000;
const MAX_DAYS = 730;

const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/** A start and end date with Apply. The range is exactly those days. */
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
 * The single filter row above a page's content: the date range, then who and
 * what. The selection lives in the URL, and everything below re-renders against
 * the same slice. `leading` goes before the date range; `extraRanges` adds
 * page-specific range options, such as a program's "Since start"; `compares`
 * says whether the page shows a change against the range before.
 *
 * There is no weekly/monthly control. The range decides how the trend charts
 * are bucketed, so a chart can never disagree with the dates beside it; a
 * custom range picks its own buckets the same way a preset does.
 */
export default function FilterBar({ range, hide = [], defaultRange = 'last-4-weeks', extraRanges = [], compares = true, leading, children }) {
  const { meta } = useDashboard();
  const { values, setParams } = useFilters({ defaultRange });
  const [picking, setPicking] = useState(false);
  const custom = Boolean(values.from);
  const filtered = ['sdr', 'program', 'theme', 'from'].some(k => values[k] && !hide.includes(k)) || values.range !== defaultRange;

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

      {!hide.includes('sdr') && (
        <MultiSelect
          label="SDRs"
          allLabel="All SDRs"
          options={(meta?.sdrs || []).map(s => s.name)}
          value={values.sdr ? values.sdr.split(',').filter(Boolean) : []}
          onChange={picked => setParams({ sdr: picked.join(',') })}
        />
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
            setParams({ range: null, from: null, to: null, sdr: null, program: null, theme: null, channel: null });
          }}
        >
          Reset filters
        </button>
      )}

      {range && (
        <span className="filters-dates">
          {range.preset === 'since-start'
            ? `${fmtDateRange(range.from, range.to)}, since the first campaign`
            : `${fmtDateRange(range.from, range.to)}${range.inProgress ? ' so far' : ''}${compares ? `, compared with ${fmtDateRange(range.previous.from, range.previous.to)}` : ''}`}
        </span>
      )}
    </div>
  );
}
