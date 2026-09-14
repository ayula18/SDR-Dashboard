'use client';

import { useState } from 'react';
import { fmtInt, fmtPct } from '@/lib/client/format';

/**
 * SDR × message angle. Shade = positive rate on one hue, light to strong,
 * scaled to the best cell with enough sample. Cells under the sample floor stay
 * unshaded so one lucky reply on a handful of leads never looks like a winner.
 */
export default function Heatmap({ rows = [], columns = [], cells = [], rowKey = 'sdr', columnKey = 'theme', rowLabel = 'SDR', minSample = 100 }) {
  const [active, setActive] = useState(null);
  const lookup = new Map(cells.map(c => [`${c[rowKey]}|${c[columnKey]}`, c]));
  const shownRows = rows.filter(r => cells.some(c => c[rowKey] === r && c.contacted > 0));
  const shownColumns = columns.filter(col => cells.some(c => c[columnKey] === col && c.contacted > 0));
  const rated = cells.filter(c => !c.lowSample && c.positiveRate != null);
  const max = Math.max(0.1, ...rated.map(c => c.positiveRate));

  const describe = c => `${c[rowKey]}, ${c[columnKey]}: ${fmtPct(c.positiveRate)} positive (${fmtInt(c.positive)} of ${fmtInt(c.contacted)} contacted)`;

  if (!shownRows.length) return <div className="chart-empty">No leads were loaded in this range.</div>;

  return (
    <div>
      <div className="heatmap-wrap">
        <table className="heatmap">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">{rowLabel}</span></th>
              {shownColumns.map(col => <th key={col} scope="col">{col}</th>)}
            </tr>
          </thead>
          <tbody>
            {shownRows.map(row => (
              <tr key={row}>
                <th scope="row">{row}</th>
                {shownColumns.map(col => {
                  const cell = lookup.get(`${row}|${col}`);
                  if (!cell || !cell.contacted) return <td key={col} className="hm-empty" />;
                  const shade = cell.lowSample || cell.positiveRate == null ? null : 12 + (cell.positiveRate / max) * 88;
                  return (
                    <td
                      key={col}
                      tabIndex={0}
                      className={shade == null ? 'hm-low' : ''}
                      aria-label={describe(cell)}
                      style={shade == null ? undefined : {
                        background: `color-mix(in oklab, var(--series-1) ${shade.toFixed(0)}%, var(--bg-surface))`,
                        color: shade > 55 ? '#ffffff' : 'var(--text-primary)',
                      }}
                      onPointerEnter={() => setActive(cell)}
                      onPointerLeave={() => setActive(null)}
                      onFocus={() => setActive(cell)}
                      onBlur={() => setActive(null)}
                    >
                      {fmtPct(cell.positiveRate)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="heatmap-foot">
        <span className="scale-bar">0% <span className="scale-ramp" aria-hidden="true" /> {fmtPct(max)}</span>
        <span className="scale-bar"><span className="scale-low" aria-hidden="true" /> Fewer than {minSample} contacted, not shaded</span>
      </div>
      <div className="heatmap-readout" aria-live="polite">{active ? describe(active) : 'Hover or focus a cell for the counts behind it.'}</div>
    </div>
  );
}
