import { Suspense } from 'react';
import CampaignDetailView from '@/components/views/CampaignDetailView';
import { safeDecode } from '@/lib/client/format';
import { qp } from '@/lib/db';

export async function generateMetadata({ params }) {
  const { id } = await params;
  try {
    const [campaign] = await qp(`SELECT name FROM dash_campaigns WHERE id = $1`, [safeDecode(id)]);
    return { title: campaign?.name || 'Campaign' };
  } catch {
    return { title: 'Campaign' };
  }
}

export default async function Page({ params }) {
  const { id } = await params;
  return <Suspense><CampaignDetailView id={safeDecode(id)} /></Suspense>;
}
