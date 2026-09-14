'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarCheck, HeartPulse, Layers, LayoutDashboard, Lightbulb, LogOut, Megaphone, Radar, TrendingUp, Users,
} from 'lucide-react';
import { endSession } from '@/lib/auth-actions';
import { useDashboard } from '@/lib/client/dashboard-context';
import { useLinkWithFilters } from '@/lib/client/use-filters';
import ThemeToggle from './ThemeToggle';
import { Avatar } from './ui/Person';

const GROUPS = [
  {
    items: [
      { label: 'Overview', href: '/', icon: LayoutDashboard },
      { label: 'Trends', href: '/trends', icon: TrendingUp },
    ],
  },
  {
    label: 'Outreach',
    items: [
      { label: 'SDRs', href: '/sdrs', icon: Users },
      { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
      { label: 'Programs', href: '/programs', icon: Layers, programs: true },
    ],
  },
  {
    label: 'Outcomes',
    items: [
      { label: 'Meetings', href: '/meetings', icon: CalendarCheck },
      { label: "What's working", href: '/insights', icon: Lightbulb },
      { label: 'Coverage', href: '/coverage', icon: Radar },
    ],
  },
  {
    label: 'System',
    items: [{ label: 'Data health', href: '/health', icon: HeartPulse, health: true }],
  },
];

export default function Sidebar({ open, onNavigate }) {
  const pathname = usePathname();
  const { meta, user, isAdmin } = useDashboard();
  const withFilters = useLinkWithFilters();

  const isActive = href => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-logo">
        <div className="logo-icon">SC</div>
        <div>
          <div style={{ fontSize: 15, lineHeight: 1.2 }}>SDR Command</div>
          <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>Reo.Dev outreach</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {GROUPS.map((group, gi) => (
          <div key={group.label || gi}>
            {group.label && <div className="sidebar-section-label">{group.label}</div>}
            {group.items.map(item => {
              // Programs highlights itself only on the list; each program has its own link below.
              const active = item.programs ? pathname === item.href : isActive(item.href);
              return (
                <div key={item.href}>
                  <Link
                    href={withFilters(item.href)}
                    className={`sidebar-link${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                  >
                    <item.icon className="link-icon" aria-hidden="true" />
                    {item.label}
                    {item.health && meta?.warnings?.length > 0 && (
                      <span className="sidebar-dot" title={`${meta.warnings.length} data gaps`} />
                    )}
                  </Link>
                  {item.programs && (meta?.programs || []).map(p => {
                    const href = `/programs/${p.slug}`;
                    return (
                      <Link
                        key={p.slug}
                        href={withFilters(href)}
                        className={`sidebar-link sub${pathname === href ? ' active' : ''}`}
                        aria-current={pathname === href ? 'page' : undefined}
                        onClick={onNavigate}
                      >
                        {p.name}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}

        <div style={{ flex: 1 }} />
        <div className="sidebar-divider" />

        {user && (
          <div className="sidebar-user">
            <Avatar name={user.name || user.email} color="var(--series-1)" size={28} />
            <div style={{ minWidth: 0 }}>
              <div className="sidebar-user-name">{user.name || user.email}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isAdmin ? 'Admin' : 'Team member'}</div>
            </div>
          </div>
        )}
        <div className="sidebar-footer">
          <ThemeToggle />
          <form action={endSession}>
            <button type="submit" className="btn btn-small">
              <LogOut aria-hidden="true" />Sign out
            </button>
          </form>
        </div>
      </nav>
    </aside>
  );
}
