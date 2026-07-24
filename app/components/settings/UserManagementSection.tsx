"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import {
  createAppUserRequest,
  fetchAppUsers,
  setAppUserDisabledRequest,
  updateAppUserRoleRequest,
} from "@/lib/users/adminUsersClient";
import {
  APP_ROLES,
  MIN_PASSWORD_LENGTH,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type AppRole,
  type AppUserRow,
} from "@/lib/users/types";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function RoleBadge({ role }: { role: AppRole | null }) {
  if (!role) {
    return (
      <span className="inline-flex rounded-full border border-destructive/30 bg-destructive-muted px-2 py-0.5 text-xs font-medium text-destructive">
        No role
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {ROLE_LABELS[role]}
    </span>
  );
}

export function UserManagementSection() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** uid currently being mutated — disables just that row's controls. */
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AppRole>("clerk");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await fetchAppUsers());
    } catch (err) {
      setError(errorMessage(err, "Could not load users."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setCreating(true);
    try {
      const created = await createAppUserRequest({
        email,
        password,
        display_name: displayName.trim() || undefined,
        role,
      });
      setSuccess(
        `Created ${created.email ?? created.uid} as ${ROLE_LABELS[role]}. Share the password with them — they can sign in straight away.`,
      );
      setEmail("");
      setPassword("");
      setDisplayName("");
      setRole("clerk");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not create user."));
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(row: AppUserRow, nextRole: AppRole) {
    if (nextRole === row.role) return;
    setError(null);
    setSuccess(null);
    setBusyUid(row.uid);
    try {
      const updated = await updateAppUserRoleRequest(row.uid, nextRole);
      setUsers((prev) => prev.map((u) => (u.uid === updated.uid ? updated : u)));
      setSuccess(
        `${updated.email ?? updated.uid} is now ${ROLE_LABELS[nextRole]}. They must sign out and back in for it to take effect.`,
      );
    } catch (err) {
      setError(errorMessage(err, "Could not change role."));
    } finally {
      setBusyUid(null);
    }
  }

  async function handleToggleDisabled(row: AppUserRow) {
    setError(null);
    setSuccess(null);
    setBusyUid(row.uid);
    try {
      const updated = await setAppUserDisabledRequest(row.uid, !row.disabled);
      setUsers((prev) => prev.map((u) => (u.uid === updated.uid ? updated : u)));
      setSuccess(
        `${updated.email ?? updated.uid} ${updated.disabled ? "disabled" : "enabled"}.`,
      );
    } catch (err) {
      setError(errorMessage(err, "Could not update user."));
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}

      <InlineAlert variant="info">
        Roles are carried in the sign-in token, so a change only applies after the user signs
        out and back in (or within an hour).
      </InlineAlert>

      <form onSubmit={handleCreate} className="space-y-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Add a user</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-user-name">Name (optional)</Label>
            <Input
              id="new-user-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-user-password">Password</Label>
            <Input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
            <p className="text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters. Ask them to change it after first
              sign-in.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-user-role">Role</Label>
            <Select
              id="new-user-role"
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
            >
              {APP_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
        </div>

        <Button type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create user"}
        </Button>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Users {loading ? "" : `(${users.length})`}
          </h3>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading users…
          </p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Current</th>
                  <th className="px-3 py-2 font-medium">Change role</th>
                  <th className="px-3 py-2 font-medium">Last sign-in</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => {
                  const isSelf = row.uid === currentUser?.uid;
                  const busy = busyUid === row.uid;
                  return (
                    <tr key={row.uid} className="border-b border-border last:border-0">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-foreground">{row.email ?? row.uid}</div>
                        {row.display_name ? (
                          <div className="text-xs text-muted-foreground">{row.display_name}</div>
                        ) : null}
                        {isSelf ? (
                          <div className="text-xs text-muted-foreground">This is you</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <RoleBadge role={row.role} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Select
                          aria-label={`Role for ${row.email ?? row.uid}`}
                          className="max-w-[180px]"
                          value={row.role ?? ""}
                          disabled={busy}
                          onChange={(e) =>
                            void handleRoleChange(row, e.target.value as AppRole)
                          }
                        >
                          {row.role === null ? <option value="">— none —</option> : null}
                          {APP_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {formatDate(row.last_sign_in_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              row.disabled ? "text-destructive" : "text-muted-foreground"
                            }
                          >
                            {row.disabled ? "Disabled" : "Active"}
                          </span>
                          <Button
                            variant={row.disabled ? "outline" : "destructive"}
                            size="sm"
                            disabled={busy || isSelf}
                            onClick={() => void handleToggleDisabled(row)}
                          >
                            {row.disabled ? "Enable" : "Disable"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
