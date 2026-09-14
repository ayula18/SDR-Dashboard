import { Suspense } from 'react';
import SdrsView from '@/components/views/SdrsView';

export const metadata = { title: 'SDRs' };

export default function Page() {
  return <Suspense><SdrsView /></Suspense>;
}
