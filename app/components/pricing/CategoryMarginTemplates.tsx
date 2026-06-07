"use client";

import { useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  loadPricingSettings,
  removeCategoryTemplate,
  saveGlobalDefaultMargin,
  upsertCategoryTemplate,
  type PricingSettingsData,
} from "@/lib/firestore/pricingSettings";
import type { PricingMode } from "@/lib/types/firestore";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/Card";

type CategoryMarginTemplatesProps = {
  settings: PricingSettingsData | null;
  knownCategories: string[];
  onSettingsChange: (next: PricingSettingsData) => void;
};

export function CategoryMarginTemplates({
  settings,
  knownCategories,
  onSettingsChange,
}: CategoryMarginTemplatesProps) {
  const [globalMargin, setGlobalMargin] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newMode, setNewMode] = useState<PricingMode>("manual");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setGlobalMargin(String(settings.globalDefaultTargetMarginPercent));
    }
  }, [settings]);

  const templateRows = useMemo(() => {
    const names = new Set<string>([
      ...Object.keys(settings?.categoryTemplates ?? {}),
      ...knownCategories,
    ]);
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [settings, knownCategories]);

  async function handleSaveGlobal() {
    setError(null);
    setSuccess(null);
    const n = Number(globalMargin);
    if (!Number.isFinite(n)) {
      setError("Enter a valid global default margin.");
      return;
    }
    setPending(true);
    try {
      await saveGlobalDefaultMargin(getDb(), n);
      const next = await loadPricingSettings(getDb());
      onSettingsChange(next);
      setSuccess("Global default margin saved.");
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function handleAddTemplate() {
    setError(null);
    setSuccess(null);
    const cat = newCategory.trim();
    const target = Number(newTarget);
    if (!cat) {
      setError("Category name is required.");
      return;
    }
    if (!Number.isFinite(target)) {
      setError("Enter a valid target margin.");
      return;
    }
    setPending(true);
    try {
      await upsertCategoryTemplate(getDb(), cat, {
        target_margin_percent: target,
        pricing_mode: newMode,
      });
      const next = await loadPricingSettings(getDb());
      onSettingsChange(next);
      setNewCategory("");
      setNewTarget("");
      setNewMode("manual");
      setSuccess(`Template saved for ${cat}.`);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function handleRemoveCategory(cat: string) {
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      await removeCategoryTemplate(getDb(), cat);
      const next = await loadPricingSettings(getDb());
      onSettingsChange(next);
      setSuccess(`Removed template for ${cat}.`);
    } catch (e) {
      setError(getFirestoreUserMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Category margin templates</CardTitle>
        <CardDescription>
          New products inherit category defaults. Analytics use product target, then category, then
          global default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="global-default-margin">Global default target margin %</Label>
            <Input
              id="global-default-margin"
              inputMode="decimal"
              value={globalMargin}
              onChange={(e) => setGlobalMargin(e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void handleSaveGlobal()}>
            Save global default
          </Button>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-medium text-foreground">Add or update category template</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-1">
              <Label htmlFor="tpl-category">Category</Label>
              <Input
                id="tpl-category"
                list="pricing-category-list"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Category name"
              />
              <datalist id="pricing-category-list">
                {knownCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-target">Target margin %</Label>
              <Input
                id="tpl-target"
                inputMode="decimal"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-mode">Pricing mode</Label>
              <Select
                id="tpl-mode"
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as PricingMode)}
              >
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
              </Select>
            </div>
          </div>
          <Button type="button" variant="primary" disabled={pending} onClick={() => void handleAddTemplate()}>
            Save category template
          </Button>
        </div>

        {templateRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Target %</th>
                  <th className="px-3 py-2 font-semibold">Mode</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templateRows.map((cat) => {
                  const tpl = settings?.categoryTemplates[cat];
                  return (
                    <tr key={cat} className="border-b border-border/60">
                      <td className="px-3 py-2 text-foreground">{cat}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {tpl ? `${tpl.target_margin_percent}%` : "—"}
                      </td>
                      <td className="px-3 py-2 capitalize">{tpl?.pricing_mode ?? "—"}</td>
                      <td className="px-3 py-2">
                        {tpl ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-2 text-xs text-destructive"
                            disabled={pending}
                            onClick={() => void handleRemoveCategory(cat)}
                          >
                            Remove
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">No template</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {error ? (
          <InlineAlert variant="error" className="text-sm">
            {error}
          </InlineAlert>
        ) : null}
        {success ? (
          <InlineAlert variant="success" className="text-sm">
            {success}
          </InlineAlert>
        ) : null}
      </CardContent>
    </Card>
  );
}
