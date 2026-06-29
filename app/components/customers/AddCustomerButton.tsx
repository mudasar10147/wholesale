"use client";

import { useState } from "react";
import { CustomerFormModal } from "@/app/components/customers/CustomerFormModal";
import { Button } from "@/app/components/ui/Button";

export function AddCustomerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Create new customer
      </Button>
      {open ? <CustomerFormModal onDismiss={() => setOpen(false)} /> : null}
    </>
  );
}
