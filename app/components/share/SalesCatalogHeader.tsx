"use client";

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button } from "@/app/components/ui/Button";

/**
 * Header for the standalone catalog page. It carries the sign-out button because the
 * salesman never sees the dashboard shell — this page is the whole app for them.
 */
export function SalesCatalogHeader() {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sales Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Purchase price, sale price, and quantity left by category.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {user?.email ? (
          <span className="max-w-[180px] truncate text-xs text-muted-foreground" title={user.email}>
            {user.email}
          </span>
        ) : null}
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
    </header>
  );
}
