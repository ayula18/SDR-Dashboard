'use client';

import { useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';

const STORAGE_KEY = 'sdr-dashboard-theme';

// The inline script in app/layout.js sets data-theme before first paint; the toggle reads it back from there.
function subscribe(onChange) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const getTheme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
const getServerTheme = () => 'dark';

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const next = theme === 'dark' ? 'light' : 'dark';

  function toggle() {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
    document.documentElement.setAttribute('data-theme', next);
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle} title={`Switch to ${next} mode`} aria-label={`Switch to ${next} mode`}>
      {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
