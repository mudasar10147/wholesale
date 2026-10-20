"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { defaultRouteForUser } from "@/lib/navigation";

type StaffOnlyProps = {
  children: ReactNode;
};

/**
 * Restricts content to the people who run the shop — admin or clerk. Social and
 * salesman users are redirected to their own landing page (Firestore rules already
 * block the reads and writes).
 *
 * The sibling of {@link AdminOnly}, which stays on the pages a clerk must not see:
 * the cash ledger, loans, profit reporting and anything that hands out roles.
 */
export function StaffOnly({ children }: StaffOnlyProps) {
  const { loading, isAdmin, isClerk, isSocial, isSalesman, isStaff } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!isStaff) {
      router.replace(defaultRouteForUser({ isAdmin, isClerk, isSocial, isSalesman }));
    }
  }, [loading, isStaff, isAdmin, isClerk, isSocial, isSalesman, router]);

  if (loading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p role="status">Loading…</p>
      </div>
    );
  }

  if (!isStaff) {
    return null;
  }

  return <>{children}</>;
}
