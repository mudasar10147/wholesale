import { NextResponse } from "next/server";
import { verifyRequestRoles } from "@/lib/server/auth";
import { createAppUser, listAppUsers } from "@/lib/server/userAdmin";
import { isAppRole, type CreateAppUserBody } from "@/lib/users/types";

/** Auth/permission failures are 403; everything else is a 400 with the message. */
function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = /allowed|token|Missing/i.test(message) ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    // Minting roles is the most privileged action in the app — admins only.
    await verifyRequestRoles(request, ["admin"]);
    const users = await listAppUsers();
    return NextResponse.json({ users });
  } catch (error) {
    return errorResponse(error, "Failed to load users.");
  }
}

export async function POST(request: Request) {
  try {
    const { uid } = await verifyRequestRoles(request, ["admin"]);
    const body = (await request.json()) as Partial<CreateAppUserBody>;

    const email = body.email?.trim() ?? "";
    const password = body.password ?? "";
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (!isAppRole(body.role)) {
      return NextResponse.json({ error: "A valid role is required." }, { status: 400 });
    }

    const user = await createAppUser({
      email,
      password,
      displayName: body.display_name,
      role: body.role,
      actorUid: uid,
    });
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error, "Failed to create user.");
  }
}
