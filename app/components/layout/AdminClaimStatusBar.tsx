"use client";

import { useEffect, useState } from "react";
import { getAuthClient } from "@/lib/firebase";

type PollState =
  | { kind: "ok"; checkedAt: string; email: string | null; uid: string; adminEffective: boolean; adminRaw: unknown }
  | { kind: "no_user"; checkedAt: string }
  | { kind: "error"; checkedAt: string; message: string };

function formatUid(uid: string): string {
  if (uid.length <= 12) return uid;
  return `${uid.slice(0, 8)}…${uid.slice(-4)}`;
}

/**
 * Dev/diagnostic strip: polls ID token claims once per second so you can confirm
 * `admin` on the current session across dashboard routes.
 */
export function AdminClaimStatusBar() {
  const [state, setState] = useState<PollState | null>(null);

  useEffect(() => {
    const poll = () => {
      const checkedAt = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const auth = getAuthClient();
      const u = auth.currentUser;
      if (!u) {
        setState({ kind: "no_user", checkedAt });
        return;
      }
      void u
        .getIdTokenResult(false)
        .then((r) => {
          const raw = r.claims.admin;
          const adminEffective = raw === true || raw === "true";
          setState({
            kind: "ok",
            checkedAt,
            email: u.email,
            uid: u.uid,
            adminEffective,
            adminRaw: raw,
          });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setState({ kind: "error", checkedAt, message });
        });
    };

    poll();
    const id = window.setInterval(poll, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="sticky top-0 z-[45] border-b border-border bg-surface-muted/95 px-3 py-2 text-xs backdrop-blur supports-[backdrop-filter]:bg-surface-muted/80 sm:px-6"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 font-mono text-muted-foreground">
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/80">Auth / admin</span>
        {!state ? (
          <span>Starting…</span>
        ) : state.kind === "no_user" ? (
          <span className="text-destructive">No Firebase user ({state.checkedAt})</span>
        ) : state.kind === "error" ? (
          <span className="text-destructive">Token read error: {state.message}</span>
        ) : (
          <>
            <span className="text-foreground/90" title={state.uid}>
              UID {formatUid(state.uid)}
            </span>
            {state.email ? (
              <span className="max-w-[200px] truncate sm:max-w-none" title={state.email}>
                {state.email}
              </span>
            ) : null}
            <span
              className={
                state.adminEffective
                  ? "font-semibold text-emerald-600 dark:text-emerald-400"
                  : "font-semibold text-destructive"
              }
            >
              admin (effective): {state.adminEffective ? "true" : "false"}
            </span>
            <span className="text-muted-foreground" title="Raw claim value from token">
              admin (raw): {state.adminRaw === undefined ? "undefined" : JSON.stringify(state.adminRaw)}
            </span>
            <span className="text-muted-foreground/90">checked {state.checkedAt}</span>
          </>
        )}
      </div>
    </div>
  );
}
