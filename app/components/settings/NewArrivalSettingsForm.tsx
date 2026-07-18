"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import {
  defaultNewArrivalSettings,
  loadNewArrivalSettings,
  saveNewArrivalSettings,
} from "@/lib/firestore/newArrivalSettings";
import {
  MAX_NEW_ARRIVAL_THRESHOLD_DAYS,
  MIN_NEW_ARRIVAL_THRESHOLD_DAYS,
} from "@/lib/products/newArrival";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

function parseThreshold(raw: string): number {
  const trimmed = raw.trim();
  const n = Number.parseInt(trimmed, 10);
  if (
    Number.isNaN(n) ||
    String(n) !== trimmed ||
    n < MIN_NEW_ARRIVAL_THRESHOLD_DAYS ||
    n > MAX_NEW_ARRIVAL_THRESHOLD_DAYS
  ) {
    throw new Error(
      `New arrival window must be a whole number between ${MIN_NEW_ARRIVAL_THRESHOLD_DAYS} and ${MAX_NEW_ARRIVAL_THRESHOLD_DAYS} days.`,
    );
  }
  return n;
}

export function NewArrivalSettingsForm() {
  const [thresholdDays, setThresholdDays] = useState(
    String(defaultNewArrivalSettings().thresholdDays),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const settings = await loadNewArrivalSettings(getDb());
        if (!cancelled) setThresholdDays(String(settings.thresholdDays));
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const days = parseThreshold(thresholdDays);
      await saveNewArrivalSettings(getDb(), { thresholdDays: days });
      setSuccess("New arrival window saved.");
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
    <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="new-arrival-threshold-days">New arrival window (days)</Label>
        <Input
          id="new-arrival-threshold-days"
          type="number"
          min={MIN_NEW_ARRIVAL_THRESHOLD_DAYS}
          max={MAX_NEW_ARRIVAL_THRESHOLD_DAYS}
          step={1}
          value={thresholdDays}
          onChange={(e) => {
            setThresholdDays(e.target.value);
            setSuccess(null);
          }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        A product wears the <span className="font-medium text-foreground">New</span> tag for this
        many days after it is first created. Restocking an existing product does not restart the
        clock — only newly created products are new arrivals.
      </p>

      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save new arrival window"}
      </Button>
    </form>
  );
}
