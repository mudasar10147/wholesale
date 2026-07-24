"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/Button";
import { PhysicalStockWorksheet } from "@/app/components/inventory/PhysicalStockWorksheet";
import { PhysicalStockCorrectionCard } from "@/app/components/inventory/PhysicalStockCorrectionCard";

export function StockCorrectionWorkspace() {
  const [mode, setMode] = useState<"worksheet" | "single">("worksheet");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "worksheet" ? "primary" : "outline"}
          onClick={() => setMode("worksheet")}
        >
          Quick worksheet
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "single" ? "primary" : "outline"}
          onClick={() => setMode("single")}
        >
          Single product (detailed)
        </Button>
      </div>
      {mode === "worksheet" ? <PhysicalStockWorksheet /> : <PhysicalStockCorrectionCard />}
    </div>
  );
}
