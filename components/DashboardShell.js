'use client';

import { Suspense, useState } from 'react';
import { Menu } from 'lucide-react';
import { DashboardProvider } from '@/lib/client/dashboard-context';
import Sidebar from './Sidebar';

export default function DashboardShell({ user, children }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <DashboardProvider user={user}>
      <div className="app-shell">
        <Suspense fallback={null}>
          <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        </Suspense>
        <div className={`scrim${navOpen ? ' open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />
        <main className="main-content">
          <div className="mobile-bar">
            <button type="button" className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <Menu aria-hidden="true" />
            </button>
            SDR Command Center
          </div>
          {children}
        </main>
      </div>
    </DashboardProvider>
  );
}
