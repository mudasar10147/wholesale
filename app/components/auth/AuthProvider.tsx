"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  /** Clerk: draft invoices, expenses, customers only (custom claim `role: "clerk"`). */
  isClerk: boolean;
  /** Social: the WhatsApp content planner only (custom claim `role: "social"`). */
  isSocial: boolean;
  /** Signed-in user may use the app (admin, clerk, or social). */
  hasAppAccess: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Matches Firestore rules `isAdmin()` (boolean or string). */
function isAdminClaim(claims: Record<string, unknown>): boolean {
  return claims.admin === true || claims.admin === "true";
}

/** Matches Firestore rules `isClerk()` — `role` must be the string `clerk`. */
function isClerkClaim(claims: Record<string, unknown>): boolean {
  return claims.role === "clerk";
}

/** Matches Firestore rules `isSocial()` — `role` must be the string `social`. */
function isSocialClaim(claims: Record<string, unknown>): boolean {
  return claims.role === "social";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isClerk, setIsClerk] = useState(false);
  const [isSocial, setIsSocial] = useState(false);

  useEffect(() => {
    const auth = getAuthClient();
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Keep loading true until ID token claims are known — avoids a frame where
        // user is set but role flags are wrong (false flash on login).
        setLoading(true);
        setUser(u);
        try {
          const token = await u.getIdTokenResult(true);
          const claims = token.claims as Record<string, unknown>;
          setIsAdmin(isAdminClaim(claims));
          setIsClerk(isClerkClaim(claims));
          setIsSocial(isSocialClaim(claims));
        } catch {
          setIsAdmin(false);
          setIsClerk(false);
          setIsSocial(false);
        }
        setLoading(false);
      } else {
        setUser(null);
        setIsAdmin(false);
        setIsClerk(false);
        setIsSocial(false);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const hasAppAccess = isAdmin || isClerk || isSocial;

  const value = useMemo(
    () => ({ user, loading, isAdmin, isClerk, isSocial, hasAppAccess }),
    [user, loading, isAdmin, isClerk, isSocial, hasAppAccess],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
