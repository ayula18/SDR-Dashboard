import { Suspense } from 'react';
import SdrMetricsView from '@/components/views/SdrMetricsView';

export const metadata = { title: 'SDR Detailed - Metrics' };

export default function Page() {
  return <Suspense><SdrMetricsView /></Suspense>;
}
