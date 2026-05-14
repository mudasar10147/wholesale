/**
 * Parse a Google service account JSON blob from env (Vercel single-line secret, etc.).
 * Shared by GCS client and Firebase Admin bootstrap.
 */

export type ParsedGoogleServiceAccount = {
  /** Present in normal GCP key downloads; may be absent in odd pastes. */
  project_id?: string;
  client_email: string;
  private_key: string;
};

export function parseGoogleServiceAccountJson(raw: string | undefined): ParsedGoogleServiceAccount | null {
  let trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed.charCodeAt(0) === 0xfeff) {
    trimmed = trimmed.slice(1);
  }
  try {
    let parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed) as unknown;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const o = parsed as Record<string, unknown>;
    const client_email = o.client_email;
    const private_key = o.private_key;
    if (typeof client_email !== "string" || typeof private_key !== "string") {
      return null;
    }
    const project_id = o.project_id;
    return {
      project_id: typeof project_id === "string" ? project_id : undefined,
      client_email,
      private_key: private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}
