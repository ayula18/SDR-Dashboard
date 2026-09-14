import { Suspense } from 'react';
import HealthView from '@/components/views/HealthView';

export const metadata = { title: 'Data health' };

export default function Page() {
  return <Suspense><HealthView /></Suspense>;
}
