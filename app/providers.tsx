"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/app/components/auth/AuthProvider";

export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
