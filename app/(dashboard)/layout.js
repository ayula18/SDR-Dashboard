import DashboardShell from '@/components/DashboardShell';
import { currentUser } from '@/lib/current-user';

export default async function DashboardLayout({ children }) {
  const user = await currentUser();
  return <DashboardShell user={user}>{children}</DashboardShell>;
}
