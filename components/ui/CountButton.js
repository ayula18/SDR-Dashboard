import { fmtInt } from '@/lib/client/format';

/**
 * A number that opens what is behind it. Zero stays plain, because there is nothing
 * to open. `label` says what it opens, for the tooltip and a screen reader.
 */
export default function CountButton({ value, label, onClick, format = fmtInt }) {
  if (!value || !onClick) return format(value);
  return (
    <button type="button" className="count-link" title={label} aria-label={`${format(value)}: ${label}`} onClick={onClick}>
      {format(value)}
    </button>
  );
}
