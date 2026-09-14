import { Suspense } from 'react';
import CampaignsView from '@/components/views/CampaignsView';

export const metadata = { title: 'Campaigns' };

export default function Page() {
  return <Suspense><CampaignsView /></Suspense>;
}
