import Sparkline from '../charts/Sparkline';
import Delta from './Delta';

/** A headline number: label, value, change and where it came from, plus a 12-period trend. */
export default function StatTile({ label, value, change, points, upIsGood = true, previous, trend, note, compact = false }) {
  const hasDelta = change !== undefined || points !== undefined;
  const hasSpark = !compact && trend?.length > 1;
  return (
    <div className={`tile${compact ? ' compact' : ''}${hasSpark ? ' has-spark' : ''}`}>
      <div className="tile-label" title={typeof label === 'string' ? label : undefined}>{label}</div>
      <div className="tile-value">{value}</div>
      {(hasDelta || previous != null) && (
        <div className="tile-foot">
          {hasDelta && <Delta change={change} points={points} upIsGood={upIsGood} />}
          {previous != null && <span className="tile-foot-text">from {previous}</span>}
        </div>
      )}
      {note && <div className="tile-note">{note}</div>}
      {hasSpark && <div className="tile-spark"><Sparkline data={trend} /></div>}
    </div>
  );
}
