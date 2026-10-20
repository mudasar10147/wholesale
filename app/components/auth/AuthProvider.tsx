"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";
import { resetReferenceData } from "@/lib/firestore/referenceData";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  /** Clerk: runs the shop day to day (custom claim `role: "clerk"`). See {@link isStaff}. */
  isClerk: boolean;
  /** Social: the WhatsApp content planner only (custom claim `role: "social"`). */
  isSocial: boolean;
  /** Salesman: the sales catalog page only (custom claim `role: "salesman"`). */
  isSalesman: boolean;
  /**
   * Admin or clerk — the people who run the shop. Mirrors `isStaff()` in
   * firestore.rules, and gates every surface a clerk now shares with an admin:
   * invoices end to end, returns, products, inventory and suppliers. What it does
   * NOT cover is the money the shop holds and who may use the app — cash ledger,
   * loans, profit reporting and user roles stay behind `isAdmin`.
   */
  isStaff: boolean;
  /** Signed-in user may use the app (admin, clerk, social, or salesman). */
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

/** Matches Firestore rules `isSalesman()` — `role` must be the string `salesman`. */
function isSalesmanClaim(claims: Record<string, unknown>): boolean {
  return claims.role === "salesman";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isClerk, setIsClerk] = useState(false);
  const [isSocial, setIsSocial] = useState(false);
  const [isSalesman, setIsSalesman] = useState(false);

  /** Last signed-in uid, so shared caches can be dropped when the user changes. */
  const lastUidRef = useRef<string | null>(null);

  useEffect(() => {
    const auth = getAuthClient();
    const unsub = onAuthStateChanged(auth, async (u) => {
      // Reference data is cached for the whole session, so signing out (or
      // switching accounts) must drop it rather than show it to the next user.
      const nextUid = u?.uid ?? null;
      if (lastUidRef.current !== null && lastUidRef.current !== nextUid) {
        resetReferenceData();
      }
      lastUidRef.current = nextUid;

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
          setIsSalesman(isSalesmanClaim(claims));
        } catch {
          setIsAdmin(false);
          setIsClerk(false);
          setIsSocial(false);
          setIsSalesman(false);
        }
        setLoading(false);
      } else {
        setUser(null);
        setIsAdmin(false);
        setIsClerk(false);
        setIsSocial(false);
        setIsSalesman(false);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const isStaff = isAdmin || isClerk;
  const hasAppAccess = isAdmin || isClerk || isSocial || isSalesman;

  const value = useMemo(
    () => ({ user, loading, isAdmin, isClerk, isSocial, isSalesman, isStaff, hasAppAccess }),
    [user, loading, isAdmin, isClerk, isSocial, isSalesman, isStaff, hasAppAccess],
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
