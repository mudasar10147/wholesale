"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";
import { getAuthUserMessage } from "@/lib/firebase/errors";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

export function LoginForm() {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextRaw = searchParams.get("next") || "/";
  const next = nextRaw.startsWith("/") ? nextRaw : "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user && isAdmin) {
      router.replace(next);
    }
  }, [loading, user, isAdmin, router, next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(getAuthClient(), email.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(getAuthUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <p className="text-center text-sm text-muted-foreground" role="status">
        Loading…
      </p>
    );
  }

  if (user && !isAdmin) {
    return (
      <InlineAlert variant="error">
        This account is signed in but does not have the admin role. Set the{" "}
        <code className="rounded bg-surface-muted px-1">admin</code> custom claim in Firebase, sign out, then sign in
        again.
      </InlineAlert>
    );
  }

  if (user && isAdmin) {
    return (
      <p className="text-center text-sm text-muted-foreground" role="status">
        Redirecting…
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
