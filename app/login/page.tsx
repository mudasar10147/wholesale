import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { LoginForm } from "@/app/login/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-surface-muted/40 px-4 py-12">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-border bg-surface p-8 shadow-[var(--shadow-xs)]">
        <div className="flex flex-col items-center gap-4 text-center">
          <Image
            src="/wholesale_logo.png"
            alt="Wholesale"
            width={180}
            height={56}
            className="h-14 w-auto object-contain"
            priority
          />
          <div>
            <h1 className="text-xl font-semibold text-foreground">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Admin access only.</p>
          </div>
        </div>
        <Suspense
          fallback={
            <p className="text-center text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          }
        >
          <LoginForm />
        </Suspense>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="text-primary underline-offset-2 hover:underline">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
