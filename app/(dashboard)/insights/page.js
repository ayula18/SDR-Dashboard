import { Suspense } from 'react';
import InsightsView from '@/components/views/InsightsView';

export const metadata = { title: "What's working" };

export default function Page() {
  return <Suspense><InsightsView /></Suspense>;
}
