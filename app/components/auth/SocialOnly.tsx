"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { defaultRouteForUser } from "@/lib/navigation";

/**
 * Restricts content to the social media manager and admins. Everyone else is sent
 * back to their own landing page (Firestore rules already block the reads).
 */
export function SocialOnly({ children }: { children: ReactNode }) {
  const { loading, isAdmin, isClerk, isSocial } = useAuth();
  const router = useRouter();
  const allowed = isAdmin || isSocial;

  useEffect(() => {
    if (loading) return;
    if (!allowed) {
      router.replace(defaultRouteForUser({ isAdmin, isClerk, isSocial }));
    }
  }, [loading, allowed, isAdmin, isClerk, isSocial, router]);

  if (loading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p role="status">Loading…</p>
      </div>
    );
  }

  if (!allowed) {
    return null;
  }

  return <>{children}</>;
}
