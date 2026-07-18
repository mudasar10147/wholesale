"use client";

import { getAuthClient } from "@/lib/firebase";
import type { SuggestionLens, SuggestionRow, SuggestionsResponse } from "@/lib/social/types";

/**
 * Client half of the suggestions API. The heavy lifting — and every sensitive read —
 * happens server-side in `lib/server/socialSuggestions.ts`.
 */
export async function fetchSuggestions(
  lens: SuggestionLens,
  days: number,
): Promise<SuggestionRow[]> {
  const user = getAuthClient().currentUser;
  if (!user) {
    throw new Error("Please sign in again.");
  }
  const token = await user.getIdToken();

  const url = new URL("/api/social/suggestions", window.location.origin);
  url.searchParams.set("lens", lens);
  url.searchParams.set("days", String(days));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = (await res.text()).trim();
  if (!text) {
    throw new Error(`Could not load suggestions (${res.status}).`);
  }

  let parsed: Partial<SuggestionsResponse> & { error?: string };
  try {
    // Not res.json() — Safari reports a parse failure on an HTML error page as an
    // unhelpful "string did not match the expected pattern".
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Server returned an unexpected response (${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(parsed.error || `Could not load suggestions (${res.status}).`);
  }
  return Array.isArray(parsed.rows) ? parsed.rows : [];
}
