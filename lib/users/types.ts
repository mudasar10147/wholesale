import type { AppRole } from "@/lib/server/auth";

export type { AppRole };

export const APP_ROLES: readonly AppRole[] = ["admin", "clerk", "social"] as const;

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  clerk: "Clerk",
  social: "Social manager",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Full access, including posting, payments, settings and user management.",
  clerk: "Day-to-day sales — drafts and customers. No settings or payments.",
  social: "Social planner and suggestions only.",
};

/** Firebase Auth is the source of truth for users; there is no `users` collection. */
export type AppUserRow = {
  uid: string;
  email: string | null;
  display_name: string | null;
  /** Null when the account has no role claim at all — it can sign in but rules reject it. */
  role: AppRole | null;
  disabled: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export type ListAppUsersResponse = {
  users: AppUserRow[];
};

export type CreateAppUserBody = {
  email: string;
  password: string;
  display_name?: string;
  role: AppRole;
};

export type UpdateAppUserBody = {
  role?: AppRole;
  disabled?: boolean;
};

export const MIN_PASSWORD_LENGTH = 8;

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}
