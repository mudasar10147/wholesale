import { NextResponse } from "next/server";
import { verifyRequestRoles } from "@/lib/server/auth";
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase/admin";
import {
  applyPhysicalCorrection,
  previewPhysicalCorrection,
  searchProductsForCorrection,
} from "@/lib/inventory/physicalStockCorrection";

// firebase-admin needs the Node runtime.
export const runtime = "nodejs";

type Body =
  | { action: "search"; query?: string }
  | { action: "preview"; productId?: string }
  | {
      action: "apply";
      productId?: string;
      physicalCount?: number;
      manualUnitCost?: number | null;
      reason?: string;
      recountSessionId?: string;
      idempotencyKey?: string;
      expectedCurrentStock?: number;
      expectedOpenLotTotal?: number;
    };

export async function POST(request: Request) {
  try {
    const { uid } = await verifyRequestRoles(request, ["admin"]);
    const body = (await request.json().catch(() => ({}))) as Body;
    const db = getFirebaseAdminFirestore();

    if (body.action === "search") {
      const hits = await searchProductsForCorrection(db, String(body.query ?? ""));
      return NextResponse.json({ status: "ok", hits });
    }

    if (body.action === "preview") {
      const productId = String(body.productId ?? "").trim();
      if (!productId) return NextResponse.json({ error: "productId is required." }, { status: 400 });
      const preview = await previewPhysicalCorrection(db, productId);
      if (preview.status === "not_found") {
        return NextResponse.json({ error: "Product not found." }, { status: 404 });
      }
      return NextResponse.json(preview);
    }

    if (body.action === "apply") {
      const productId = String(body.productId ?? "").trim();
      const idempotencyKey = String(body.idempotencyKey ?? "").trim();
      const recountSessionId = String(body.recountSessionId ?? "").trim();
      if (!productId || !idempotencyKey || !recountSessionId) {
        return NextResponse.json(
          { error: "productId, idempotencyKey and recountSessionId are required." },
          { status: 400 },
        );
      }
      if (typeof body.physicalCount !== "number") {
        return NextResponse.json({ error: "physicalCount is required." }, { status: 400 });
      }
      if (
        typeof body.expectedCurrentStock !== "number" ||
        typeof body.expectedOpenLotTotal !== "number"
      ) {
        return NextResponse.json(
          { error: "expectedCurrentStock and expectedOpenLotTotal (from preview) are required." },
          { status: 400 },
        );
      }

      // Operator email for the audit trail (not trusted from the client).
      let operatorEmail = "";
      try {
        operatorEmail = (await getFirebaseAdminAuth().getUser(uid)).email ?? "";
      } catch {
        operatorEmail = "";
      }

      const result = await applyPhysicalCorrection(db, {
        productId,
        physicalCount: body.physicalCount,
        manualUnitCost: body.manualUnitCost ?? null,
        reason: typeof body.reason === "string" ? body.reason : "",
        recountSessionId,
        idempotencyKey,
        operatorUid: uid,
        operatorEmail,
        expectedCurrentStock: body.expectedCurrentStock,
        expectedOpenLotTotal: body.expectedOpenLotTotal,
      });

      const status =
        result.status === "not_found"
          ? 404
          : result.status === "invalid_count" || result.status === "cost_required"
            ? 422
            : result.status === "stale_preview"
              ? 409
              : 200;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock correction failed.";
    const status = /allowed|token|Missing/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
