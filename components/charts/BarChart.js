'use client';

import { useState } from 'react';
import { fmtInt } from '@/lib/client/format';
import Legend from './Legend';
import { accessor, labelStride, niceScale } from './scale';
import { useElementWidth } from './use-width';

const PAD = { top: 10, right: 12, bottom: 26, left: 44 };

/** Column with a 4px rounded data end, square on the baseline. */
function columnPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * Columns per period, grouped when there are up to three series. Bars are at
 * most 24px wide with a 2px gap inside a group; the whole period is the hover
 * target and the tooltip lists every series.
 */
export default function BarChart({ data = [], x = 'label', tooltipLabel, series = [], height = 220, format = fmtInt, integer = true, label }) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(null);
  const xLabel = accessor(x);
  const ttLabel = tooltipLabel ? accessor(tooltipLabel) : xLabel;
  const hasData = data.length > 0 && series.length > 0;

  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = Math.max(40, height - PAD.top - PAD.bottom);
  const maxValue = hasData ? Math.max(0, ...data.flatMap(d => series.map(s => Number(d[s.key]) || 0))) : 0;
  const scale = niceScale(maxValue, { integer });
  const band = plotW / Math.max(1, data.length);
  const gap = 2;
  const barW = Math.max(2, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / Math.max(1, series.length)));
  const groupW = barW * series.length + gap * (series.length - 1);
  const barX = (i, si) => PAD.left + i * band + (band - groupW) / 2 + si * (barW + gap);
  const yAt = v => PAD.top + plotH - ((Number(v) || 0) / scale.max) * plotH;
  const stride = labelStride(data.length, plotW, 64);
  const tipX = active != null ? PAD.left + active * band + band / 2 : 0;

  const onKeyDown = event => {
    if (!hasData) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setActive(i => Math.min(data.length - 1, (i ?? -1) + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setActive(i => Math.max(0, (i ?? data.length) - 1));
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };

  return (
    <div ref={ref} className="chart" tabIndex={hasData ? 0 : -1} onKeyDown={onKeyDown} onBlur={() => setActive(null)}>
      {!hasData ? (
        <div className="chart-empty">Nothing in this range yet.</div>
      ) : (
        <>
          {series.length > 1 && <Legend series={series} kind="rect" />}
          <div style={{ position: 'relative', height }}>
            <svg width={width} height={height} role="img" aria-label={label} onPointerLeave={() => setActive(null)}>
              {scale.ticks.map(t => (
                <g key={t}>
                  <line x1={PAD.left} x2={PAD.left + plotW} y1={yAt(t)} y2={yAt(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth="1" shapeRendering="crispEdges" />
                  <text className="axis-text" x={PAD.left - 8} y={yAt(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
                </g>
              ))}
              {data.map((d, i) => ((data.length - 1 - i) % stride === 0 ? (
                <text key={`x${i}`} className="axis-text" x={PAD.left + i * band + band / 2} y={height - 6} textAnchor="middle">{xLabel(d)}</text>
              ) : null))}
              {data.map((d, i) => (
                <g key={`b${i}`} opacity={active != null && active !== i ? 0.45 : 1}>
                  {series.map((s, si) => {
                    const h = ((Number(d[s.key]) || 0) / scale.max) * plotH;
                    return <path key={s.key} d={columnPath(barX(i, si), PAD.top + plotH - h, barW, h)} fill={s.color} />;
                  })}
                </g>
              ))}
              {data.map((d, i) => (
                <rect key={`h${i}`} x={PAD.left + i * band} y={PAD.top} width={band} height={plotH} fill="transparent" onPointerEnter={() => setActive(i)} />
              ))}
            </svg>
            {active != null && (
              <div
                className="chart-tooltip viz-tooltip"
                style={{ left: tipX, top: 0, transform: `translateX(${tipX > width * 0.6 ? 'calc(-100% - 12px)' : '12px'})` }}
              >
                <div className="tt-title">{ttLabel(data[active])}</div>
                {series.map(s => (
                  <div key={s.key} className="tt-row">
                    <span className="tt-key" style={{ background: s.color }} />
                    <strong>{format(data[active][s.key])}</strong>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
