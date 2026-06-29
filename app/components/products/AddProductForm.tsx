"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { createProduct } from "@/lib/firestore/products";
import { loadPricingSettings, type PricingSettingsData } from "@/lib/firestore/pricingSettings";
import { inheritPricingFieldsForNewProduct } from "@/lib/pricing/automaticPricing";
import { automaticSalePrice } from "@/lib/pricing/metrics";
import { uploadProductImage } from "@/lib/upload/productImages";
import {
  parseNonNegativeDecimal,
  parseNonNegativeIntStrict,
} from "@/lib/validation/numbers";
import { Button } from "@/app/components/ui/Button";
import { CategorySuggestInput } from "@/app/components/products/CategorySuggestInput";
import { TraderSelectInput } from "@/app/components/products/TraderSelectInput";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

const FORM_ALERT_ID = "add-product-form-alert";

type AddProductFormProps = {
  /** Called after a product is successfully created (e.g. to close a modal). */
  onCreated?: () => void;
};

export function AddProductForm({ onCreated }: AddProductFormProps = {}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [traderId, setTraderId] = useState("");
  const [traderName, setTraderName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pricingSettings, setPricingSettings] = useState<PricingSettingsData | null>(null);
  const [pricingModeHint, setPricingModeHint] = useState<string | null>(null);

  useEffect(() => {
    void loadPricingSettings(getDb())
      .then(setPricingSettings)
      .catch(() => setPricingSettings(null));
  }, []);

  useEffect(() => {
    if (!pricingSettings) return;
    const cat = category.trim();
    const cost = parseNonNegativeDecimal(costPrice);
    const inherited = inheritPricingFieldsForNewProduct(
      cat || undefined,
      pricingSettings.categoryTemplates,
      pricingSettings.globalDefaultTargetMarginPercent,
      cost.ok ? cost.value : 0,
    );
    if (inherited.pricing_mode === "automatic" && cost.ok) {
      setSalePrice(String(automaticSalePrice(cost.value, inherited.target_margin_percent ?? 15)));
      setPricingModeHint(
        `Automatic pricing (${inherited.target_margin_percent}% target) — sale price calculated from cost.`,
      );
    } else if (cat && pricingSettings.categoryTemplates[cat]) {
      setPricingModeHint(
        `Category template: ${inherited.pricing_mode} mode, ${inherited.target_margin_percent}% target.`,
      );
    } else {
      setPricingModeHint(null);
    }
  }, [category, costPrice, pricingSettings]);

  const nameInvalid = error === "Name is required.";
  const numbersInvalid = Boolean(error && error !== "Name is required.");
  const showPurchaseSource = useMemo(() => {
    const stock = parseNonNegativeIntStrict(stockQuantity);
    return stock.ok && stock.value > 0;
  }, [stockQuantity]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }

    const cost = parseNonNegativeDecimal(costPrice);
    if (!cost.ok) {
      setError(cost.message ?? "Invalid cost price.");
      return;
    }
    const sale = parseNonNegativeDecimal(salePrice);
    if (!sale.ok) {
      setError(sale.message ?? "Invalid sale price.");
      return;
    }
    const stock = parseNonNegativeIntStrict(stockQuantity);
    if (!stock.ok) {
      setError(stock.message ?? "Invalid stock quantity.");
      return;
    }
    if (stock.value > 0 && !traderId) {
      setError("Trader (where purchased) is required when adding initial stock.");
      return;
    }

    setSubmitting(true);
    try {
      const cat = category.trim();
      let image:
        | { url: string; path: string; mimeType: string; size: number }
        | undefined;
      if (imageFile) {
        const uploaded = await uploadProductImage(imageFile);
        image = {
          url: uploaded.url,
          path: uploaded.path,
          mimeType: uploaded.mimeType,
          size: uploaded.size,
        };
      }

      await createProduct(getDb(), {
        name: trimmedName,
        category: cat || undefined,
        cost_price: cost.value,
        sale_price: sale.value,
        initial_quantity: stock.value,
        purchase_source: stock.value > 0 ? traderName.trim() : undefined,
        trader_id: stock.value > 0 ? traderId : undefined,
        image,
        ...(pricingSettings
          ? (() => {
              const inherited = inheritPricingFieldsForNewProduct(
                cat || undefined,
                pricingSettings.categoryTemplates,
                pricingSettings.globalDefaultTargetMarginPercent,
                cost.value,
              );
              return {
                target_margin_percent: inherited.target_margin_percent,
                pricing_mode: inherited.pricing_mode,
              };
            })()
          : {}),
      });
      setName("");
      setCategory("");
      setImageFile(null);
      setCostPrice("");
      setSalePrice("");
      setStockQuantity("");
      setTraderId("");
      setTraderName("");
      setSuccess(true);
      onCreated?.();
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="product-name">Name</Label>
          <Input
            id="product-name"
            name="name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rice 25kg"
            required
            maxLength={200}
            aria-invalid={nameInvalid}
            aria-describedby={nameInvalid ? FORM_ALERT_ID : undefined}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="product-category">Category (optional)</Label>
          <CategorySuggestInput
            id="product-category"
            name="category"
            value={category}
            onChange={setCategory}
            placeholder="Type or pick from existing categories"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="product-image">Product image (optional)</Label>
          <Input
            id="product-image"
            name="image_file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-cost">Cost price</Label>
          <Input
            id="product-cost"
            name="cost_price"
            inputMode="decimal"
            min={0}
            step="any"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
            placeholder="0"
            aria-invalid={numbersInvalid}
            aria-describedby={numbersInvalid ? FORM_ALERT_ID : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-sale">Sale price</Label>
          <Input
            id="product-sale"
            name="sale_price"
            inputMode="decimal"
            min={0}
            step="any"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            placeholder="0"
            aria-invalid={numbersInvalid}
            aria-describedby={numbersInvalid ? FORM_ALERT_ID : undefined}
          />
          {pricingModeHint ? (
            <p className="text-xs text-muted-foreground">{pricingModeHint}</p>
          ) : null}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="product-stock">Initial purchase quantity</Label>
          <Input
            id="product-stock"
            name="stock_quantity"
            inputMode="numeric"
            min={0}
            step={1}
            value={stockQuantity}
            onChange={(e) => setStockQuantity(e.target.value)}
            placeholder="0"
            aria-invalid={numbersInvalid}
            aria-describedby={numbersInvalid ? FORM_ALERT_ID : "product-stock-hint"}
          />
          <p id="product-stock-hint" className="text-sm text-muted-foreground">
            Units bought now are stocked in at the cost price above and reduce estimated cash on hand.
            Use 0 to add the product only and buy stock later from the product page.
          </p>
        </div>
        {showPurchaseSource ? (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="product-trader">Trader (where purchased)</Label>
            <TraderSelectInput
              id="product-trader"
              value={traderId}
              onChange={(id, nm) => {
                setTraderId(id);
                setTraderName(nm);
              }}
              disabled={submitting}
              aria-invalid={numbersInvalid}
              aria-describedby={numbersInvalid ? FORM_ALERT_ID : undefined}
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <InlineAlert variant="error" id={FORM_ALERT_ID}>
          {error}
        </InlineAlert>
      ) : null}
      {success ? (
        <InlineAlert variant="success">Product saved.</InlineAlert>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Add product"}
      </Button>
    </form>
  );
}
