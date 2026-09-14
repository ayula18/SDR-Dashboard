import { Suspense } from 'react';
import ProgramDetailView from '@/components/views/ProgramDetailView';
import { qp } from '@/lib/db';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const [program] = await qp(`SELECT name FROM dash_programs WHERE slug = $1`, [slug]);
    return { title: program?.name || 'Program' };
  } catch {
    return { title: 'Program' };
  }
}

export default async function Page({ params }) {
  const { slug } = await params;
  return <Suspense><ProgramDetailView slug={slug} /></Suspense>;
}
