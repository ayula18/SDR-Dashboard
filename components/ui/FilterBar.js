'use client';

import { useDashboard } from '@/lib/client/dashboard-context';
import { fmtDateRange } from '@/lib/client/format';
import { RANGE_OPTIONS, useFilters } from '@/lib/client/use-filters';

/**
 * The single filter row above a page's content. Date range first, then trend
 * grain, then who and what. The selection lives in the URL, and everything
 * below re-renders against the same slice.
 */
export default function FilterBar({ range, hide = [], defaultRange = 'last-4-weeks', showGrain = true, children }) {
  const { meta } = useDashboard();
  const { values, setParams } = useFilters({ defaultRange });
  const custom = Boolean(values.from);
  const grain = values.grain || range?.grain || 'week';
  const filtered = ['sdr', 'program', 'theme', 'from', 'grain'].some(k => values[k] && !hide.includes(k)) || values.range !== defaultRange;

  return (
    <div className="filters" role="group" aria-label="Filters">
      <select
        aria-label="Date range"
        className="select-trigger"
        value={custom ? 'custom' : values.range}
        onChange={e => setParams({ range: e.target.value === defaultRange ? null : e.target.value, from: null, to: null })}
      >
        {custom && <option value="custom">Custom range</option>}
        {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

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
          onClick={() => setParams({ range: null, from: null, to: null, grain: null, sdr: null, program: null, theme: null })}
        >
          Reset filters
        </button>
      )}

      {range && (
        <span className="filters-dates">
          {fmtDateRange(range.from, range.to)}{range.inProgress ? ' so far' : ''}, compared with {fmtDateRange(range.previous.from, range.previous.to)}
        </span>
      )}
    </div>
  );
}
