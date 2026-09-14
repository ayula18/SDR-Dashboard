import { Suspense } from 'react';
import MeetingsView from '@/components/views/MeetingsView';

export const metadata = { title: 'Meetings' };

export default function Page() {
  return <Suspense><MeetingsView /></Suspense>;
}
