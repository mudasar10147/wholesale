"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Matches Firestore rules `isAdmin()` (boolean or string). */
function isAdminClaim(claims: Record<string, unknown>): boolean {
  return claims.admin === true || claims.admin === "true";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const auth = getAuthClient();
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Keep loading true until ID token claims are known — avoids a frame where
        // user is set but isAdmin is still false (false "not admin" flash on login).
        setLoading(true);
        setUser(u);
        try {
          const token = await u.getIdTokenResult(true);
          setIsAdmin(isAdminClaim(token.claims as Record<string, unknown>));
        } catch {
          setIsAdmin(false);
        }
        setLoading(false);
      } else {
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const value = useMemo(
    () => ({ user, loading, isAdmin }),
    [user, loading, isAdmin],
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
