"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button } from "@/app/components/ui/Button";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading, hasAppAccess } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (user) return;
    const dest =
      pathname && pathname !== "/login" ? pathname : "/";
    const q = `?next=${encodeURIComponent(dest)}`;
    router.replace(`/login${q}`);
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p role="status">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!hasAppAccess) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">Not authorized</h1>
        <p className="text-sm text-muted-foreground">
          This account is not allowed to use the app. Ask an owner to set the{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">admin</code> or{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">role: clerk</code> custom claim on your
          user in Firebase.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void signOut(getAuthClient()).then(() => {
              router.replace("/login");
            });
          }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
