import { NextResponse } from "next/server";
import { verifyRequestRoles } from "@/lib/server/auth";
import { setAppUserDisabled, updateAppUserRole } from "@/lib/server/userAdmin";
import { isAppRole, type UpdateAppUserBody } from "@/lib/users/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const { uid: actorUid } = await verifyRequestRoles(request, ["admin"]);
    const { uid } = await params;
    const targetUid = uid?.trim() ?? "";
    if (!targetUid) {
      return NextResponse.json({ error: "User id is required." }, { status: 400 });
    }

    const body = (await request.json()) as UpdateAppUserBody;
    const wantsRole = body.role !== undefined;
    const wantsDisabled = typeof body.disabled === "boolean";
    if (!wantsRole && !wantsDisabled) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    let user;
    if (wantsRole) {
      if (!isAppRole(body.role)) {
        return NextResponse.json({ error: "A valid role is required." }, { status: 400 });
      }
      user = await updateAppUserRole({ uid: targetUid, role: body.role, actorUid });
    }
    if (wantsDisabled) {
      user = await setAppUserDisabled({
        uid: targetUid,
        disabled: body.disabled as boolean,
        actorUid,
      });
    }

    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update user.";
    const status = /allowed|token|Missing/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
