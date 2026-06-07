import { NextResponse } from "next/server";
import { mergeCustomers } from "@/lib/server/mergeCustomers";
import { verifyRequestAuth } from "@/lib/server/auth";
import type { CustomerInput } from "@/lib/firestore/customers";

type MergeBody = {
  keep_customer_id?: string;
  merge_customer_id?: string;
  final_profile?: CustomerInput;
};

export async function POST(request: Request) {
  try {
    const { uid } = await verifyRequestAuth(request, true);
    const body = (await request.json()) as MergeBody;
    const keepCustomerId = body.keep_customer_id?.trim() ?? "";
    const mergeCustomerId = body.merge_customer_id?.trim() ?? "";
    const finalProfile = body.final_profile;

    if (!keepCustomerId || !mergeCustomerId) {
      return NextResponse.json(
        { error: "keep_customer_id and merge_customer_id are required." },
        { status: 400 },
      );
    }
    if (!finalProfile || typeof finalProfile.name !== "string") {
      return NextResponse.json({ error: "final_profile with name is required." }, { status: 400 });
    }

    const result = await mergeCustomers({
      keepCustomerId,
      mergeCustomerId,
      mergedByUid: uid,
      finalProfile: {
        name: finalProfile.name,
        phone: finalProfile.phone,
        email: finalProfile.email,
        address: finalProfile.address,
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Merge failed.";
    const status = message.includes("not allowed") || message.includes("token") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
