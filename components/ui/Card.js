'use client';

import { useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';

/**
 * A titled panel. Pass `table` (a function returning the same numbers as a
 * table) and the card gets a Chart / Table switch, so no value is hover-only.
 */
export default function Card({ title, subtitle, actions, footnote, table, className = '', children }) {
  const [view, setView] = useState('chart');
  const showHead = title || subtitle || actions || table;

  return (
    <section className={`card ${className}`.trim()}>
      {showHead && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {(actions || table) && (
            <div className="card-actions">
              {actions}
              {table && (
                <div className="segmented small" role="group" aria-label="Show as">
                  <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
                    <BarChart3 aria-hidden="true" />Chart
                  </button>
                  <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
                    <Table2 aria-hidden="true" />Table
                  </button>
                </div>
              )}
            </div>
          )}
        </header>
      )}
      {table && view === 'table' ? table() : children}
      {footnote && <p className="card-foot">{footnote}</p>}
    </section>
  );
}
