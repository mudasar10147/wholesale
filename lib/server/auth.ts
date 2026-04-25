import { getFirebaseAdminAuth } from "@/lib/firebase/admin";

function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

type AppUserClaims = {
  admin?: boolean | string;
  role?: string;
};

function isAdminClaim(claims: AppUserClaims): boolean {
  return claims.admin === true || claims.admin === "true";
}

function hasAppAccess(claims: AppUserClaims): boolean {
  return isAdminClaim(claims) || claims.role === "clerk";
}

export async function verifyRequestAuth(request: Request, requireAdmin: boolean): Promise<{ uid: string }> {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) {
    throw new Error("Missing bearer token.");
  }

  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  const claims = decoded as AppUserClaims;
  const allowed = requireAdmin ? isAdminClaim(claims) : hasAppAccess(claims);
  if (!allowed) {
    throw new Error("You are not allowed to perform this action.");
  }

  return { uid: decoded.uid };
}
