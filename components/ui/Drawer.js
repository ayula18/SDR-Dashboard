'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * A panel that slides over the right of the page. Escape, the close button or a
 * click outside closes it; focus moves into it on open and back on close. Pass a
 * stable `onClose` (useCallback), or focus jumps back to the close button on
 * every render.
 */
export default function Drawer({ open, onClose, title, subtitle, actions, children }) {
  const titleId = useId();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const returnTo = document.activeElement;
    closeRef.current?.focus();
    const onKey = e => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-root">
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="drawer-head">
          <div className="drawer-head-text">
            <h2 id={titleId} className="drawer-title">{title}</h2>
            {subtitle && <p className="drawer-sub">{subtitle}</p>}
          </div>
          <div className="drawer-actions">
            {actions}
            <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
