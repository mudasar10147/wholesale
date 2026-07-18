"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { defaultRouteForUser } from "@/lib/navigation";

type AdminOnlyProps = {
  children: ReactNode;
};

/**
 * Restricts content to admin users. Everyone else is redirected to their own landing
 * page (Firestore rules already block the reads and writes).
 */
export function AdminOnly({ children }: AdminOnlyProps) {
  const { loading, isAdmin, isClerk, isSocial } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!isAdmin) {
      router.replace(defaultRouteForUser({ isAdmin, isClerk, isSocial }));
    }
  }, [loading, isAdmin, isClerk, isSocial, router]);

  if (loading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p role="status">Loading…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return <>{children}</>;
}
