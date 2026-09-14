'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useDashboard } from '@/lib/client/dashboard-context';

/** Data gaps that change how the numbers should be read, stated once, above the numbers. */
export default function WarningsBanner() {
  const { meta } = useDashboard();
  const warnings = meta?.warnings || [];
  if (!warnings.length) return null;

  return (
    <div className="notice" role="note">
      <AlertTriangle aria-hidden="true" />
      <details>
        <summary>{warnings.length === 1 ? 'One data gap affects these numbers' : `${warnings.length} data gaps affect these numbers`}</summary>
        <ul>{warnings.map(w => <li key={w.key}>{w.message}</li>)}</ul>
        <Link href="/health">Open data health</Link>
      </details>
    </div>
  );
}
