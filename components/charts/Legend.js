/** Series legend. The key mirrors the mark: a line for line charts, a rounded square for bars. */
export default function Legend({ series, kind = 'line' }) {
  return (
    <div className="chart-legend">
      {series.map(s => (
        <span key={s.key} className="legend-item">
          <span className={`legend-key ${kind}`} style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </span>
      ))}
    </div>
  );
}
