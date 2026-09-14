import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { fmtChange, fmtPoints } from '@/lib/client/format';

/**
 * Change against the previous period. Never colour alone: an arrow, a signed
 * value, and green or red depending on whether up is good for this metric.
 * Pass `points` for a rate (percentage points) instead of `change` (percent).
 */
export default function Delta({ change, points, upIsGood = true, small = false, title }) {
  const value = points !== undefined ? points : change;
  const size = small ? ' sm' : '';

  if (value == null) {
    return <span className={`delta flat${size}`} title={title || 'Nothing to compare with in the previous period'}>–</span>;
  }

  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const tone = direction === 'flat' ? 'flat' : (direction === 'up') === upIsGood ? 'good' : 'bad';
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;

  return (
    <span className={`delta ${tone}${size}`} title={title}>
      <Icon aria-hidden="true" />
      {points !== undefined ? fmtPoints(points) : fmtChange(change)}
    </span>
  );
}
