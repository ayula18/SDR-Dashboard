import { Suspense } from 'react';
import CoverageView from '@/components/views/CoverageView';

export const metadata = { title: 'Coverage' };

export default function Page() {
  return <Suspense><CoverageView /></Suspense>;
}
