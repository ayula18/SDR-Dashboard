'use client';

import { useState } from 'react';
import { fmtInt } from '@/lib/client/format';
import Legend from './Legend';
import { accessor, labelStride, niceScale } from './scale';
import { useElementWidth } from './use-width';

const PAD = { top: 10, right: 16, bottom: 26, left: 44 };

/**
 * Values over time on one y-axis. Up to three series in the validated palette
 * slots; 2px lines; a crosshair that snaps to the nearest period and one
 * tooltip listing every series. A single series gets a 10% wash. Arrow keys
 * move the crosshair when the chart has focus.
 */
export default function LineChart({ data = [], x = 'label', tooltipLabel, series = [], height = 220, format = fmtInt, integer = true, label }) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(null);
  const xLabel = accessor(x);
  const ttLabel = tooltipLabel ? accessor(tooltipLabel) : xLabel;
  const hasData = data.length > 0 && series.length > 0;

  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = Math.max(40, height - PAD.top - PAD.bottom);
  const maxValue = hasData ? Math.max(0, ...data.flatMap(d => series.map(s => Number(d[s.key]) || 0))) : 0;
  const scale = niceScale(maxValue, { integer });
  const xAt = i => PAD.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yAt = v => PAD.top + plotH - ((Number(v) || 0) / scale.max) * plotH;
  const stride = labelStride(data.length, plotW, 72);

  const nearest = event => {
    if (data.length <= 1) return 0;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - PAD.left) / plotW;
    return Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1))));
  };

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

  const path = key => data.map((d, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(d[key]).toFixed(1)}`).join('');
  const marker = active ?? data.length - 1;
  const tipX = active != null ? xAt(active) : 0;

  return (
    <div ref={ref} className="chart" tabIndex={hasData ? 0 : -1} onKeyDown={onKeyDown} onBlur={() => setActive(null)}>
      {!hasData ? (
        <div className="chart-empty">Nothing in this range yet.</div>
      ) : (
        <>
          {series.length > 1 && <Legend series={series} kind="line" />}
          <div style={{ position: 'relative', height }}>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={label}
              onPointerMove={e => setActive(nearest(e))}
              onPointerLeave={() => setActive(null)}
            >
              {scale.ticks.map(t => (
                <g key={t}>
                  <line x1={PAD.left} x2={PAD.left + plotW} y1={yAt(t)} y2={yAt(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth="1" shapeRendering="crispEdges" />
                  <text className="axis-text" x={PAD.left - 8} y={yAt(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
                </g>
              ))}
              {data.map((d, i) => ((data.length - 1 - i) % stride === 0 ? (
                <text
                  key={i}
                  className="axis-text"
                  x={xAt(i)}
                  y={height - 6}
                  textAnchor={data.length > 1 && i === 0 ? 'start' : data.length > 1 && i === data.length - 1 ? 'end' : 'middle'}
                >
                  {xLabel(d)}
                </text>
              ) : null))}
              {series.length === 1 && (
                <path
                  d={`${path(series[0].key)}L${xAt(data.length - 1).toFixed(1)},${yAt(0)}L${xAt(0).toFixed(1)},${yAt(0)}Z`}
                  fill={series[0].color}
                  opacity="0.1"
                />
              )}
              {series.map(s => (
                <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {active != null && (
                <line x1={xAt(active)} x2={xAt(active)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--viz-axis)" strokeWidth="1" shapeRendering="crispEdges" />
              )}
              {series.map(s => (
                <circle key={s.key} cx={xAt(marker)} cy={yAt(data[marker][s.key])} r="4" fill={s.color} stroke="var(--bg-surface)" strokeWidth="2" />
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
