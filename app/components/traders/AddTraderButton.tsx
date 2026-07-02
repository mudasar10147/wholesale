"use client";

import { useState } from "react";
import { TraderFormModal } from "@/app/components/traders/TraderFormModal";
import { Button } from "@/app/components/ui/Button";

export function AddTraderButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Create trader
      </Button>
      {open ? <TraderFormModal onDismiss={() => setOpen(false)} /> : null}
    </>
  );
}
