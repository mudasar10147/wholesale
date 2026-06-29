"use client";

import { useState } from "react";
import { AddCashEntryModal } from "@/app/components/cash/AddCashEntryModal";
import { Button } from "@/app/components/ui/Button";

export function AddLoanEntryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Add loan entry
      </Button>
      {open ? (
        <AddCashEntryModal initialMode="loan" lockMode onDismiss={() => setOpen(false)} />
      ) : null}
    </>
  );
}
