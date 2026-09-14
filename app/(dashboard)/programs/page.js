import { Suspense } from 'react';
import ProgramsView from '@/components/views/ProgramsView';

export const metadata = { title: 'Programs' };

export default function Page() {
  return <Suspense><ProgramsView /></Suspense>;
}
