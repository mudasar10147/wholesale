"use client";

import { useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { createTrader, updateTrader, type TraderInput } from "@/lib/firestore/traders";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

const PHONE_RE = /^[+\d][\d\s()-]*$/;

export type TraderFormInitial = {
  name?: string;
  phone?: string;
  address?: string;
  contact_person?: string;
  city?: string;
  notes?: string;
};

type TraderFormProps = {
  /** When set, the form updates this trader instead of creating a new one. */
  traderId?: string;
  initial?: TraderFormInitial;
  /** Called after a successful create/update with the trader id and saved name. */
  onSaved?: (traderId: string, name: string) => void;
  onCancel?: () => void;
  alertId?: string;
};

function validate(input: {
  name: string;
  phone: string;
  address: string;
  contactPerson: string;
  city: string;
  notes: string;
}): string | null {
  const name = input.name.trim();
  if (!name) return "Trader name is required.";
  if (name.length < 2) return "Trader name must be at least 2 characters.";
  if (name.length > 120) return "Trader name must be 120 characters or fewer.";
  const phone = input.phone.trim();
  if (phone && (phone.length > 25 || !PHONE_RE.test(phone))) {
    return "Enter a valid phone number.";
  }
  if (input.address.trim().length > 300) return "Address must be 300 characters or fewer.";
  if (input.contactPerson.trim().length > 120) {
    return "Contact person must be 120 characters or fewer.";
  }
  if (input.city.trim().length > 120) return "City must be 120 characters or fewer.";
  if (input.notes.trim().length > 500) return "Notes must be 500 characters or fewer.";
  return null;
}

export function TraderForm({
  traderId,
  initial,
  onSaved,
  onCancel,
  alertId = "trader-form-alert",
}: TraderFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [contactPerson, setContactPerson] = useState(initial?.contact_person ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isEditing = !!traderId;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const message = validate({ name, phone, address, contactPerson, city, notes });
    if (message) {
      setError(message);
      return;
    }

    const input: TraderInput = { name, phone, address, contact_person: contactPerson, city, notes };
    setBusy(true);
    try {
      if (traderId) {
        await updateTrader(getDb(), traderId, input);
        setSuccess("Trader updated.");
        onSaved?.(traderId, name.trim());
      } else {
        const id = await createTrader(getDb(), input);
        setSuccess("Trader created.");
        setName("");
        setPhone("");
        setAddress("");
        setContactPerson("");
        setCity("");
        setNotes("");
        onSaved?.(id, name.trim());
      }
    } catch (err) {
      setError(getFirestoreUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="trader-name">Trader name</Label>
          <Input
            id="trader-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hall Road Traders"
            maxLength={120}
            required
            aria-invalid={!!error}
            aria-describedby={error ? alertId : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trader-phone">Phone (optional)</Label>
          <Input
            id="trader-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+92…"
            maxLength={25}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trader-contact">Contact person (optional)</Label>
          <Input
            id="trader-contact"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="e.g. Ahmed"
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trader-city">City / area (optional)</Label>
          <Input
            id="trader-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Lahore"
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trader-address">Address (optional)</Label>
          <Input
            id="trader-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Shop / street details"
            maxLength={300}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="trader-notes">Notes (optional)</Label>
          <Input
            id="trader-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering about this trader"
            maxLength={500}
          />
        </div>
      </div>

      {error ? (
        <InlineAlert id={alertId} variant="error">
          {error}
        </InlineAlert>
      ) : null}
      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : isEditing ? "Update trader" : "Create trader"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
