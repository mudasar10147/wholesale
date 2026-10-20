import { NextResponse } from "next/server";
import { verifyRequestRoles } from "@/lib/server/auth";
import { getFirebaseAdminApp, getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import { triggerValidation } from "@/lib/inventory/validationApi";

// firebase-admin needs the Node runtime.
export const runtime = "nodejs";

/** Auth/permission failures are 403; rate limits 429; everything else 500. */
export async function POST(request: Request) {
  try {
    // Who may run a validation is enforced server-side; the UI check is cosmetic
    // (§9.6). Staff — admin or clerk — may run one, since the inventory page they
    // both work from is where a mismatch shows up.
    const { uid } = await verifyRequestRoles(request, ["admin", "clerk"]);

    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    // Default to incremental; full requires an explicit, separately-labelled action.
    const mode = body.mode === "full" ? "full" : "incremental";

    const projectId = getFirebaseAdminApp().options.projectId ?? "unknown";
    const db = getFirebaseAdminFirestore();
    const result = await triggerValidation(db, { mode, projectId, uid });

    return NextResponse.json(result, { status: result.status === "rate_limited" ? 429 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation failed.";
    const status = /allowed|token|Missing/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
