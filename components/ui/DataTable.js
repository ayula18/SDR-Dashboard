'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Search } from 'lucide-react';
import { downloadCsv } from '@/lib/client/format';

const cellValue = (column, row) => (column.csv ? column.csv(row) : row[column.key]);

/**
 * Sortable table with optional search, paging and CSV export.
 *
 * columns: [{ key, label, align?: 'right', render?(row), sort?(row), csv?(row) | false, sortable? }]
 * `csv` is also what search matches against, so give link and badge columns one.
 */
export default function DataTable({
  columns,
  rows = [],
  rowKey = (row, i) => row.id ?? i,
  initialSort = null,
  searchable = false,
  searchPlaceholder = 'Search',
  pageSize = 25,
  exportName,
  empty = 'Nothing in this range.',
  toolbar,
  dense = false,
}) {
  const [sort, setSort] = useState(initialSort);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(row => columns.some(c => c.csv !== false && String(cellValue(c, row) ?? '').toLowerCase().includes(q)));
  }, [rows, query, columns]);

  const sorted = useMemo(() => {
    const column = sort && columns.find(c => c.key === sort.key);
    if (!column) return filtered;
    const get = column.sort || (row => row[column.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // empty values sink, whichever way the column is sorted
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize);

  const toggleSort = key => {
    setPage(0);
    setSort(s => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  };

  const exportCsv = () => downloadCsv(
    exportName,
    columns.filter(c => c.csv !== false).map(c => ({
      label: typeof c.label === 'string' ? c.label : c.key,
      key: c.key,
      csv: typeof c.csv === 'function' ? c.csv : undefined,
    })),
    sorted
  );

  return (
    <div className="dt">
      {(searchable || exportName || toolbar) && (
        <div className="dt-toolbar">
          <div className="dt-toolbar-left">
            {searchable && (
              <label className="search-input">
                <Search className="search-icon" aria-hidden="true" />
                <span className="sr-only">{searchPlaceholder}</span>
                <input value={query} placeholder={searchPlaceholder} onChange={e => { setQuery(e.target.value); setPage(0); }} />
              </label>
            )}
            {toolbar}
          </div>
          <div className="dt-toolbar-right">
            <span className="muted" style={{ fontSize: 12 }}>
              {sorted.length === rows.length ? `${rows.length} rows` : `${sorted.length} of ${rows.length} rows`}
            </span>
            {exportName && (
              <button type="button" className="btn btn-small" onClick={exportCsv} disabled={!sorted.length}>
                <Download aria-hidden="true" />Export CSV
              </button>
            )}
          </div>
        </div>
      )}

      <div className="dt-scroll">
        <table className={`data-table${dense ? ' dense' : ''}`}>
          <thead>
            <tr>
              {columns.map(c => {
                const active = sort?.key === c.key;
                const Icon = active && sort.dir === 'asc' ? ChevronUp : ChevronDown;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.align === 'right' ? 'num' : undefined}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.sortable === false ? c.label : (
                      <button type="button" className="dt-sort" onClick={() => toggleSort(c.key)}>
                        {c.label}{active && <Icon aria-hidden="true" />}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={columns.length} className="dt-empty">{query ? 'No rows match that search.' : empty}</td></tr>
            ) : visible.map((row, i) => (
              <tr key={rowKey(row, i)}>
                {columns.map(c => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                    {c.render ? c.render(row) : (row[c.key] ?? '–')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="dt-pager">
          <span>{current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of {sorted.length}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-small" disabled={current === 0} onClick={() => setPage(current - 1)}>
              <ChevronLeft aria-hidden="true" />Previous
            </button>
            <button type="button" className="btn btn-small" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next<ChevronRight aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
