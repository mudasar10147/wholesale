"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button } from "@/app/components/ui/Button";

/**
 * Gate for the sales catalog. This page used to be world-readable — anyone with the
 * link saw every cost price, sale price and stock level. It is now a signed-in page
 * for the `salesman` role (admins too, so an owner can check what the team sees).
 *
 * The page lives outside the dashboard shell, so unlike AdminOnly this guard has to
 * handle the signed-out case itself and send the visitor to the login screen.
 */
export function RequireSalesman({ children }: { children: ReactNode }) {
  const { user, loading, isAdmin, isSalesman } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = isAdmin || isSalesman;

  useEffect(() => {
    if (loading) return;
    if (user) return;
    const dest = pathname && pathname !== "/login" ? pathname : "/";
    router.replace(`/login?next=${encodeURIComponent(dest)}`);
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

  if (!allowed) {
    return (
      <div className="mx-auto mt-16 flex max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">Not authorized</h1>
        <p className="text-sm text-muted-foreground">
          The sales catalog is only for accounts with the{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">role: salesman</code> claim. Ask an owner
          to give you that role in Settings → Users &amp; roles.
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
