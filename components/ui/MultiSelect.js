'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Pick one, several, or all of something. Closed it reads like the other filter
 * triggers; open it is a checklist, so comparing two SDRs is one click more than
 * looking at one. Picking nothing means everyone.
 */
export default function MultiSelect({ label, allLabel, options = [], value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = event => { if (!box.current?.contains(event.target)) setOpen(false); };
    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      box.current?.querySelector('.multi-trigger')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = option => onChange(value.includes(option) ? value.filter(v => v !== option) : [...value, option]);
  const summary = value.length === 0 ? allLabel : value.length <= 2 ? value.join(', ') : `${value.length} ${label.toLowerCase()}`;

  return (
    <div className="multi-select" ref={box}>
      <button
        type="button"
        className="multi-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={value.length ? `${label}: ${value.join(', ')}` : allLabel}
        onClick={() => setOpen(o => !o)}
      >
        <span className="multi-value">{summary}</span>
        <ChevronDown aria-hidden="true" />
      </button>

      {open && (
        <div className="multi-menu" role="listbox" aria-multiselectable="true" aria-label={label}>
          <button type="button" className="multi-option" role="option" aria-selected={value.length === 0} onClick={() => onChange([])}>
            <span className="multi-check">{value.length === 0 && <Check aria-hidden="true" />}</span>
            {allLabel}
          </button>
          {options.map(option => (
            <button
              key={option}
              type="button"
              className="multi-option"
              role="option"
              aria-selected={value.includes(option)}
              onClick={() => toggle(option)}
            >
              <span className="multi-check">{value.includes(option) && <Check aria-hidden="true" />}</span>
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
