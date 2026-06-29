"use client";

import { useState } from "react";
import { AddExpenseModal } from "@/app/components/expenses/AddExpenseModal";
import { Button } from "@/app/components/ui/Button";

export function AddExpenseButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Add expense
      </Button>
      {open ? <AddExpenseModal onDismiss={() => setOpen(false)} /> : null}
    </>
  );
}
