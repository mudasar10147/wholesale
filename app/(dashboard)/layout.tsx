import { RequireAdmin } from "@/app/components/auth/RequireAdmin";
import { DashboardShell } from "@/app/components/layout/DashboardShell";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RequireAdmin>
      <DashboardShell>{children}</DashboardShell>
    </RequireAdmin>
  );
}
