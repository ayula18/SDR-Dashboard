import { fmtInt, fmtPct } from '@/lib/client/format';

/**
 * Stages as bars from one baseline, each with its value and its conversion from
 * the stage before. One hue: the stages are a single series in order.
 */
export default function Funnel({ stages = [], format = fmtInt, compact = false }) {
  const max = Math.max(1, ...stages.map(s => Number(s.value) || 0));

  return (
    <ol className={`funnel-list${compact ? ' compact' : ''}`}>
      {stages.map((stage, i) => {
        const previous = i > 0 ? Number(stages[i - 1].value) || 0 : null;
        const value = Number(stage.value) || 0;
        const conversion = previous ? (value / previous) * 100 : null;
        return (
          <li key={stage.key} className="funnel-row">
            <span className="funnel-label">{stage.label}</span>
            <span className="funnel-track" aria-hidden="true">
              {value > 0 && <span className="funnel-fill" style={{ width: `${Math.max(0.8, (value / max) * 100)}%` }} />}
            </span>
            <span className="funnel-value">{format(value)}</span>
            <span className="funnel-conv">
              {conversion == null ? '' : `${fmtPct(conversion, conversion < 10 ? 1 : 0)} of previous`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
