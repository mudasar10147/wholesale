"use client";

import Link from "next/link";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { buttonClasses } from "@/app/components/ui/Button";

type SidebarNewInvoiceButtonProps = {
  onNavigate?: () => void;
};

function PlusIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function SidebarNewInvoiceButton({ onNavigate }: SidebarNewInvoiceButtonProps) {
  const { isAdmin, isClerk } = useAuth();
  if (!isAdmin && !isClerk) return null;

  return (
    <Link
      href="/sales/new"
      onClick={onNavigate}
      className={buttonClasses({
        variant: "primary",
        size: "sm",
        className: "w-full gap-2 shadow-sm",
      })}
    >
      <PlusIcon />
      Create New Invoice
    </Link>
  );
}
