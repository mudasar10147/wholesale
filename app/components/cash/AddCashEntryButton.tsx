"use client";

import { useState } from "react";
import { AddCashEntryModal } from "@/app/components/cash/AddCashEntryModal";
import { Button } from "@/app/components/ui/Button";

export function AddCashEntryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Add cash entry
      </Button>
      {open ? (
        <AddCashEntryModal initialMode="general" lockMode onDismiss={() => setOpen(false)} />
      ) : null}
    </>
  );
}
