import { Suspense } from 'react';
import TrendsView from '@/components/views/TrendsView';

export const metadata = { title: 'Trends' };

export default function Page() {
  return <Suspense><TrendsView /></Suspense>;
}
