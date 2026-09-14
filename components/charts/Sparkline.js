/**
 * Twelve-period trend under a stat tile: a quiet neutral line from zero, with
 * the current period marked in the accent. Stretches to its container unless
 * given a width; the dot is HTML so stretching never turns it into an oval.
 */
export default function Sparkline({ data = [], width, height = 28 }) {
  const values = data.map(v => (Number.isFinite(Number(v)) ? Number(v) : 0));
  if (values.length < 2) return null;

  const span = 100;
  const pad = 4;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * span,
    pad + (1 - (v - min) / range) * (height - pad * 2),
  ]);
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(1)}`).join('');
  const lastY = points[points.length - 1][1];

  return (
    <span className="sparkline" style={{ width, height }} aria-hidden="true">
      <svg width="100%" height={height} viewBox={`0 0 ${span} ${height}`} preserveAspectRatio="none">
        <path d={d} fill="none" stroke="var(--viz-neutral)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="sparkline-dot" style={{ top: lastY }} />
    </span>
  );
}
