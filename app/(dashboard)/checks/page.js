import { Suspense } from 'react';
import ChecksView from '@/components/views/ChecksView';

export const metadata = { title: 'Meeting checks' };

export default function Page() {
  return <Suspense><ChecksView /></Suspense>;
}
