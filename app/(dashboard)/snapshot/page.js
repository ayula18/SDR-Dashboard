import { Suspense } from 'react';
import SnapshotView from '@/components/views/SnapshotView';

export const metadata = { title: 'Snapshot View' };

export default function Page() {
  return <Suspense><SnapshotView /></Suspense>;
}
