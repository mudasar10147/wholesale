"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  defaultCustomerEngagementTierSettings,
  loadCustomerEngagementSettings,
  saveCustomerEngagementSettings,
  type CustomerEngagementTierSettings,
} from "@/lib/firestore/customerEngagementSettings";
import { describeEngagementRules } from "@/lib/customers/customerEngagement";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

function parseWholeNumber(raw: string, label: string): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (Number.isNaN(n) || n < 0 || String(n) !== raw.trim()) {
    throw new Error(`${label} must be a whole number.`);
  }
  return n;
}

function parseAmount(raw: string, label: string): number {
  const n = Number.parseFloat(raw.trim().replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return n;
}

function parsePercent(raw: string, label: string): number {
  const n = Number.parseFloat(raw.trim().replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }
  return n;
}

function settingsToForm(settings: CustomerEngagementTierSettings) {
  return {
    rollingWindowDays: String(settings.rollingWindowDays),
    premiumMinOrders: String(settings.premiumMinOrders),
    premiumMinSpend: String(settings.premiumMinSpend),
    premiumDiscountPercent: String(settings.premiumDiscountPercent),
    silverMinOrders: String(settings.silverMinOrders),
    silverMinSpend: String(settings.silverMinSpend),
    silverMaxSpend: String(settings.silverMaxSpend),
    silverDiscountPercent: String(settings.silverDiscountPercent),
    bronzeOrders: String(settings.bronzeOrders),
    bronzeMaxSpend: String(settings.bronzeMaxSpend),
  };
}

export function CustomerEngagementSettingsForm() {
  const [form, setForm] = useState(() => settingsToForm(defaultCustomerEngagementTierSettings()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewSettings, setPreviewSettings] = useState<CustomerEngagementTierSettings>(
    defaultCustomerEngagementTierSettings(),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const settings = await loadCustomerEngagementSettings(getDb());
        if (!cancelled) {
          setForm(settingsToForm(settings));
          setPreviewSettings(settings);
        }
      } catch (err) {
        if (!cancelled) setError(getFirestoreUserMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const next: CustomerEngagementTierSettings = {
        rollingWindowDays: parseWholeNumber(form.rollingWindowDays, "Rolling window (days)"),
        premiumMinOrders: parseWholeNumber(form.premiumMinOrders, "Premium minimum orders"),
        premiumMinSpend: parseAmount(form.premiumMinSpend, "Premium minimum spend"),
        premiumDiscountPercent: parsePercent(form.premiumDiscountPercent, "Premium discount"),
        silverMinOrders: parseWholeNumber(form.silverMinOrders, "Silver minimum orders"),
        silverMinSpend: parseAmount(form.silverMinSpend, "Silver minimum spend"),
        silverMaxSpend: parseAmount(form.silverMaxSpend, "Silver maximum spend"),
        silverDiscountPercent: parsePercent(form.silverDiscountPercent, "Silver discount"),
        bronzeOrders: parseWholeNumber(form.bronzeOrders, "Bronze order count"),
        bronzeMaxSpend: parseAmount(form.bronzeMaxSpend, "Bronze maximum spend"),
      };

      await saveCustomerEngagementSettings(getDb(), next);
      setPreviewSettings(next);
      setSuccess("Customer engagement settings saved.");
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }

  return (
    <form className="space-y-6" onSubmit={(e) => void handleSubmit(e)}>
      <Card>
        <CardHeader>
          <CardTitle>How tiers work</CardTitle>
          <CardDescription>
            Customers are classified from posted invoices in the rolling window. Premium and Silver
            require both order frequency and spend. Everyone else with history becomes Needs
            follow-up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="rolling-window-days">Rolling window (days)</Label>
            <Input
              id="rolling-window-days"
              type="number"
              min={7}
              max={365}
              step={1}
              value={form.rollingWindowDays}
              onChange={(e) => updateField("rollingWindowDays", e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">{describeEngagementRules(previewSettings)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Premium customers</CardTitle>
          <CardDescription>
            Must meet both minimum orders and minimum spend in the rolling window.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="premium-min-orders">Minimum orders</Label>
            <Input
              id="premium-min-orders"
              type="number"
              min={1}
              step={1}
              value={form.premiumMinOrders}
              onChange={(e) => updateField("premiumMinOrders", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="premium-min-spend">Minimum spend (PKR)</Label>
            <Input
              id="premium-min-spend"
              type="text"
              inputMode="decimal"
              value={form.premiumMinSpend}
              onChange={(e) => updateField("premiumMinSpend", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="premium-discount">Tier discount (%)</Label>
            <Input
              id="premium-discount"
              type="text"
              inputMode="decimal"
              value={form.premiumDiscountPercent}
              onChange={(e) => updateField("premiumDiscountPercent", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Silver customers</CardTitle>
          <CardDescription>
            Must meet minimum orders and spend between the silver minimum and maximum (PKR).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="silver-min-orders">Minimum orders</Label>
            <Input
              id="silver-min-orders"
              type="number"
              min={1}
              step={1}
              value={form.silverMinOrders}
              onChange={(e) => updateField("silverMinOrders", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="silver-min-spend">Minimum spend (PKR)</Label>
            <Input
              id="silver-min-spend"
              type="text"
              inputMode="decimal"
              value={form.silverMinSpend}
              onChange={(e) => updateField("silverMinSpend", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="silver-max-spend">Maximum spend (PKR)</Label>
            <Input
              id="silver-max-spend"
              type="text"
              inputMode="decimal"
              value={form.silverMaxSpend}
              onChange={(e) => updateField("silverMaxSpend", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="silver-discount">Tier discount (%)</Label>
            <Input
              id="silver-discount"
              type="text"
              inputMode="decimal"
              value={form.silverDiscountPercent}
              onChange={(e) => updateField("silverDiscountPercent", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bronze customers</CardTitle>
          <CardDescription>
            Exactly this many orders with total spend below the bronze maximum (PKR).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bronze-orders">Order count</Label>
            <Input
              id="bronze-orders"
              type="number"
              min={1}
              step={1}
              value={form.bronzeOrders}
              onChange={(e) => updateField("bronzeOrders", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bronze-max-spend">Maximum spend (PKR)</Label>
            <Input
              id="bronze-max-spend"
              type="text"
              inputMode="decimal"
              value={form.bronzeMaxSpend}
              onChange={(e) => updateField("bronzeMaxSpend", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save customer engagement settings"}
      </Button>
    </form>
  );
}
