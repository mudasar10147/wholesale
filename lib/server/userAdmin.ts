import type { UserRecord } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import type { AppRole } from "@/lib/server/auth";
import { MIN_PASSWORD_LENGTH, type AppUserRow } from "@/lib/users/types";

const AUDIT_COLLECTION = "user_admin_audit";
const LIST_PAGE_SIZE = 1000;

/**
 * The role model has two shapes in the rules: admin is a boolean claim
 * (`token.admin == true`), clerk and social are a string claim (`token.role`).
 * We keep roles mutually exclusive and always write the whole claims object, so
 * `setCustomUserClaims` clears the other field for us — no half-set states.
 */
function claimsForRole(role: AppRole): Record<string, unknown> {
  return role === "admin" ? { admin: true } : { role };
}

export function roleFromClaims(claims: Record<string, unknown> | undefined): AppRole | null {
  if (!claims) return null;
  if (claims.admin === true || claims.admin === "true") return "admin";
  if (claims.role === "clerk") return "clerk";
  if (claims.role === "social") return "social";
  return null;
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toRow(user: UserRecord): AppUserRow {
  return {
    uid: user.uid,
    email: user.email ?? null,
    display_name: user.displayName ?? null,
    role: roleFromClaims(user.customClaims),
    disabled: user.disabled,
    created_at: toIso(user.metadata.creationTime),
    last_sign_in_at: toIso(user.metadata.lastSignInTime),
  };
}

async function listAllUserRecords(): Promise<UserRecord[]> {
  const auth = getFirebaseAdminAuth();
  const all: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(LIST_PAGE_SIZE, pageToken);
    all.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return all;
}

/**
 * Best-effort audit row. Role changes are the most privileged action in the app,
 * so they should not be anonymous — but a logging failure must not roll back a
 * change that already applied in Firebase Auth.
 */
async function writeAudit(entry: {
  action: string;
  actorUid: string;
  targetUid: string;
  targetEmail: string | null;
  fromRole?: AppRole | null;
  toRole?: AppRole | null;
  disabled?: boolean;
}): Promise<void> {
  try {
    await getFirebaseAdminFirestore()
      .collection(AUDIT_COLLECTION)
      .add({ ...entry, created_at: FieldValue.serverTimestamp() });
  } catch (error) {
    console.error("[userAdmin] audit write failed", error);
  }
}

export async function listAppUsers(): Promise<AppUserRow[]> {
  const rows = (await listAllUserRecords()).map(toRow);
  // Roleless accounts first — they are the ones needing attention.
  return rows.sort((a, b) => {
    if ((a.role === null) !== (b.role === null)) return a.role === null ? -1 : 1;
    return (a.email ?? a.uid).localeCompare(b.email ?? b.uid);
  });
}

/** Enabled admins other than `excludeUid`. Used to refuse the last-admin lockout. */
async function countOtherEnabledAdmins(excludeUid: string): Promise<number> {
  const users = await listAllUserRecords();
  return users.filter(
    (u) => u.uid !== excludeUid && !u.disabled && roleFromClaims(u.customClaims) === "admin",
  ).length;
}

export async function createAppUser(input: {
  email: string;
  password: string;
  displayName?: string;
  role: AppRole;
  actorUid: string;
}): Promise<AppUserRow> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName?.trim();

  if (!email) {
    throw new Error("Email is required.");
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const auth = getFirebaseAdminAuth();
  const created = await auth.createUser({
    email,
    password: input.password,
    ...(displayName ? { displayName } : {}),
    emailVerified: false,
    disabled: false,
  });

  // A user with no claims can sign in but every rule rejects them, so the role
  // must land before we report success.
  await auth.setCustomUserClaims(created.uid, claimsForRole(input.role));

  await writeAudit({
    action: "create",
    actorUid: input.actorUid,
    targetUid: created.uid,
    targetEmail: email,
    toRole: input.role,
  });

  const fresh = await auth.getUser(created.uid);
  return toRow(fresh);
}

export async function updateAppUserRole(input: {
  uid: string;
  role: AppRole;
  actorUid: string;
}): Promise<AppUserRow> {
  const auth = getFirebaseAdminAuth();
  const target = await auth.getUser(input.uid);
  const currentRole = roleFromClaims(target.customClaims);

  if (input.uid === input.actorUid && currentRole === "admin" && input.role !== "admin") {
    throw new Error("You cannot remove your own admin role.");
  }
  if (currentRole === "admin" && input.role !== "admin") {
    const others = await countOtherEnabledAdmins(input.uid);
    if (others === 0) {
      throw new Error("This is the last admin. Promote another admin first.");
    }
  }

  await auth.setCustomUserClaims(input.uid, claimsForRole(input.role));
  await writeAudit({
    action: "role_change",
    actorUid: input.actorUid,
    targetUid: input.uid,
    targetEmail: target.email ?? null,
    fromRole: currentRole,
    toRole: input.role,
  });

  return toRow(await auth.getUser(input.uid));
}

export async function setAppUserDisabled(input: {
  uid: string;
  disabled: boolean;
  actorUid: string;
}): Promise<AppUserRow> {
  const auth = getFirebaseAdminAuth();
  const target = await auth.getUser(input.uid);

  if (input.disabled) {
    if (input.uid === input.actorUid) {
      throw new Error("You cannot disable your own account.");
    }
    if (roleFromClaims(target.customClaims) === "admin") {
      const others = await countOtherEnabledAdmins(input.uid);
      if (others === 0) {
        throw new Error("This is the last admin. Promote another admin first.");
      }
    }
  }

  await auth.updateUser(input.uid, { disabled: input.disabled });
  await writeAudit({
    action: input.disabled ? "disable" : "enable",
    actorUid: input.actorUid,
    targetUid: input.uid,
    targetEmail: target.email ?? null,
    disabled: input.disabled,
  });

  return toRow(await auth.getUser(input.uid));
}
