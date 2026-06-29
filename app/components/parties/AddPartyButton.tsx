"use client";

import { useState } from "react";
import { AddPartyModal } from "@/app/components/parties/AddPartyModal";
import { Button } from "@/app/components/ui/Button";

export function AddPartyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Create party
      </Button>
      {open ? <AddPartyModal onDismiss={() => setOpen(false)} /> : null}
    </>
  );
}
