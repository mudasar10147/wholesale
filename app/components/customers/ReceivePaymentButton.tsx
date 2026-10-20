"use client";

import { useState } from "react";
import { useAuth } from "@/app/components/auth/AuthProvider";
import { ReceiveCustomerPaymentModal } from "@/app/components/customers/ReceiveCustomerPaymentModal";
import { Button } from "@/app/components/ui/Button";

type Props = {
  /** Opens the dialog with this customer chosen. */
  customerId?: string;
  size?: "sm" | "md";
};

/** Staff only — social and salesman users never see it (Firestore rules refuse it too). */
export function ReceivePaymentButton({ customerId, size = "md" }: Props) {
  const { isStaff } = useAuth();
  const [open, setOpen] = useState(false);
  if (!isStaff) return null;
  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)}>
        Receive payment
      </Button>
      {open ? <ReceiveCustomerPaymentModal initialCustomerId={customerId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
