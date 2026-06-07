"use client";

import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { updateProductPricing } from "@/lib/firestore/pricing";
import { automaticSalePrice } from "@/lib/pricing/metrics";
import type { EnrichedPricingRow } from "@/lib/pricing/metrics";
import type { PricingMode } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import { cn } from "@/lib/utils";

type EditPricingModalProps = {
  row: EnrichedPricingRow;
  onDismiss: () => void;
  onSaved: () => void;
};

export function EditPricingModal({ row, onDismiss, onSaved }: EditPricingModalProps) {
  const [targetMargin, setTargetMargin] = useState(
    row.target_margin_percent !== undefined ? String(row.target_margin_percent) : "",
  );
  const [mode, setMode] = useState<PricingMode>(row.pricing_mode ?? "manual");
  const [salePrice, setSalePrice] = useState(String(row.sale_price));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTargetMargin(
      row.target_margin_percent !== undefined ? String(row.target_margin_percent) : "",
    );
    setMode(row.pricing_mode ?? "manual");
    setSalePrice(String(row.sale_price));
  }, [row]);

  const previewAutoPrice =
    mode === "automatic"
      ? automaticSalePrice(
          row.cost_price,
          targetMargin.trim() !== "" ? Number(targetMargin) : row.effectiveTargetMarginPercent,
        )
      : null;

  async function handleSave() {
    setError(null);
    const payload: {
      target_margin_percent?: number;
      pricing_mode?: PricingMode;
      sale_price?: number;
    } = { pricing_mode: mode };

    if (targetMargin.trim() !== "") {
      const t = Number(targetMargin);
      if (!Number.isFinite(t)) {
        setError("Invalid target margin.");
        return;
      }
      payload.target_margin_percent = t;
    }

    if (mode === "manual") {
      const sp = Number(salePrice);
      if (!Number.isFinite(sp) || sp < 0) {
        setError("Invalid sale price.");
        return;
      }
      payload.sale_price = sp;
    }

    setPending(true);
    try {
      await updateProductPricing(getDb(), row.id, payload);
      onSaved();
      onDismiss();
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-pricing-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-pricing-title" className="text-lg font-semibold text-foreground">
          Edit pricing — {row.name}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cost: {row.cost_price.toLocaleString()} · Current sale: {row.sale_price.toLocaleString()}
        </p>

        <div className="mt-5 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="edit-target-margin">Target margin %</Label>
            <Input
              id="edit-target-margin"
              inputMode="decimal"
              value={targetMargin}
              onChange={(e) => setTargetMargin(e.target.value)}
              placeholder={`Effective: ${row.effectiveTargetMarginPercent.toFixed(1)}%`}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-pricing-mode">Pricing mode</Label>
            <Select
              id="edit-pricing-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PricingMode)}
            >
              <option value="manual">Manual</option>
              <option value="automatic">Automatic</option>
            </Select>
          </div>
          {mode === "manual" ? (
            <div className="space-y-1">
              <Label htmlFor="edit-sale-price">Sale price</Label>
              <Input
                id="edit-sale-price"
                inputMode="decimal"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Automatic sale price preview:{" "}
              <span className="tabular-nums font-medium text-foreground">
                {previewAutoPrice?.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }) ?? "—"}
              </span>
            </p>
          )}
        </div>

        {error ? (
          <InlineAlert variant="error" className="mt-4 text-sm">
            {error}
          </InlineAlert>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            className={cn(pending && "opacity-70")}
            onClick={() => void handleSave()}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
