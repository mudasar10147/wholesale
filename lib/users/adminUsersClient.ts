"use client";

import { getAuthClient } from "@/lib/firebase";
import type {
  AppRole,
  AppUserRow,
  CreateAppUserBody,
  ListAppUsersResponse,
  UpdateAppUserBody,
} from "@/lib/users/types";

async function authHeaders(): Promise<Record<string, string>> {
  const user = getAuthClient().currentUser;
  if (!user) {
    throw new Error("Please sign in again.");
  }
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const text = (await res.text()).trim();
  if (!text) {
    throw new Error(`${fallback} (${res.status}).`);
  }
  let parsed: Partial<T> & { error?: string };
  try {
    // Not res.json() — Safari reports a parse failure on an HTML error page as an
    // unhelpful "string did not match the expected pattern".
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Server returned an unexpected response (${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(parsed.error || `${fallback} (${res.status}).`);
  }
  return parsed as T;
}

export async function fetchAppUsers(): Promise<AppUserRow[]> {
  const res = await fetch("/api/admin/users", { headers: await authHeaders() });
  const body = await readJson<ListAppUsersResponse>(res, "Could not load users");
  return Array.isArray(body.users) ? body.users : [];
}

export async function createAppUserRequest(input: CreateAppUserBody): Promise<AppUserRow> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = await readJson<{ user: AppUserRow }>(res, "Could not create user");
  return body.user;
}

async function patchAppUser(uid: string, patch: UpdateAppUserBody): Promise<AppUserRow> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  const body = await readJson<{ user: AppUserRow }>(res, "Could not update user");
  return body.user;
}

export function updateAppUserRoleRequest(uid: string, role: AppRole): Promise<AppUserRow> {
  return patchAppUser(uid, { role });
}

export function setAppUserDisabledRequest(uid: string, disabled: boolean): Promise<AppUserRow> {
  return patchAppUser(uid, { disabled });
}
