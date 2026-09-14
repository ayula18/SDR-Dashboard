'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, Trophy } from 'lucide-react';
import { fmtInt } from '@/lib/client/format';

/**
 * Ranked horizontal bars from one baseline with the value at the tip.
 * With `emphasis`, the best and worst rows (only among rows with enough sample)
 * take the reserved good/bad colours, always with an icon and a word.
 * Rows below the sample floor are drawn grey.
 */
export default function HBarList({ rows = [], label, value, format = fmtInt, detail, href, emphasis = false, limit = 8, emptyText = 'Nothing to show for this range.' }) {
  const [expanded, setExpanded] = useState(false);
  const getLabel = typeof label === 'function' ? label : row => row[label];
  const getValue = typeof value === 'function' ? value : row => row[value];

  if (!rows.length) return <div className="chart-empty">{emptyText}</div>;

  const max = Math.max(0, ...rows.map(row => Number(getValue(row)) || 0));
  const shown = expanded ? rows : rows.slice(0, limit);

  return (
    <>
      <ul className="hbars">
        {shown.map((row, i) => {
          const raw = getValue(row);
          const v = Number(raw) || 0;
          const state = emphasis && row.best ? 'best' : emphasis && row.worst ? 'worst' : row.lowSample ? 'low' : '';
          const name = getLabel(row);
          const link = href?.(row);
          return (
            <li key={`${name}-${i}`} className={`hbar ${state}`.trim()}>
              <span className="hbar-label" title={String(name)}>{link ? <Link href={link}>{name}</Link> : name}</span>
              <span className="hbar-track" aria-hidden="true">
                {v > 0 && max > 0 && <span className="hbar-fill" style={{ width: `${Math.max(1, (v / max) * 100)}%` }} />}
              </span>
              <span className="hbar-value">
                {state === 'best' && <span className="badge good"><Trophy aria-hidden="true" />Best</span>}
                {state === 'worst' && <span className="badge bad"><ArrowDown aria-hidden="true" />Lowest</span>}
                {detail && <span className="hbar-detail">{detail(row)}</span>}
                <strong>{format(raw)}</strong>
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > limit && (
        <button type="button" className="hbar-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}
