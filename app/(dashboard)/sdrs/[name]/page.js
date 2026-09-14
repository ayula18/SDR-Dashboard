import { Suspense } from 'react';
import SdrDetailView from '@/components/views/SdrDetailView';
import { safeDecode } from '@/lib/client/format';

export async function generateMetadata({ params }) {
  const { name } = await params;
  return { title: safeDecode(name) };
}

export default async function Page({ params }) {
  const { name } = await params;
  return <Suspense><SdrDetailView name={safeDecode(name)} /></Suspense>;
}
