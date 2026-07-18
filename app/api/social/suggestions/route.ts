import { NextResponse } from "next/server";
import { verifyRequestRoles } from "@/lib/server/auth";
import { computeSuggestions } from "@/lib/server/socialSuggestions";
import { SUGGESTION_LENSES, type SuggestionLens, type SuggestionsResponse } from "@/lib/social/types";

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

function parseLens(raw: string | null): SuggestionLens | null {
  return SUGGESTION_LENSES.find((lens) => lens === raw) ?? null;
}

function parseDays(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(parsed)));
}

export async function GET(request: Request) {
  try {
    // Admins and the social manager only. Clerks have no business here.
    await verifyRequestRoles(request, ["admin", "social"]);

    const url = new URL(request.url);
    const lens = parseLens(url.searchParams.get("lens"));
    if (!lens) {
      return NextResponse.json({ error: "Unknown suggestion lens." }, { status: 400 });
    }
    const days = parseDays(url.searchParams.get("days"));

    const rows = await computeSuggestions(lens, days);
    const body: SuggestionsResponse = { lens, days, rows };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load suggestions.";
    const status = /allowed|token|Missing/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
