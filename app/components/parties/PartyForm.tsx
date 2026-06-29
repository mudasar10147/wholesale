"use client";

import { useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { createParty, updateParty, type PartyInput } from "@/lib/firestore/parties";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

const PHONE_RE = /^[+\d][\d\s()-]*$/;

export type PartyFormInitial = {
  name?: string;
  phone?: string;
  address?: string;
  contact_person?: string;
  city?: string;
  notes?: string;
};

type PartyFormProps = {
  /** When set, the form updates this party instead of creating a new one. */
  partyId?: string;
  initial?: PartyFormInitial;
  /** Called after a successful create/update with the party id and saved name. */
  onSaved?: (partyId: string, name: string) => void;
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
  if (!name) return "Party name is required.";
  if (name.length < 2) return "Party name must be at least 2 characters.";
  if (name.length > 120) return "Party name must be 120 characters or fewer.";
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

export function PartyForm({
  partyId,
  initial,
  onSaved,
  onCancel,
  alertId = "party-form-alert",
}: PartyFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [contactPerson, setContactPerson] = useState(initial?.contact_person ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isEditing = !!partyId;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const message = validate({ name, phone, address, contactPerson, city, notes });
    if (message) {
      setError(message);
      return;
    }

    const input: PartyInput = { name, phone, address, contact_person: contactPerson, city, notes };
    setBusy(true);
    try {
      if (partyId) {
        await updateParty(getDb(), partyId, input);
        setSuccess("Party updated.");
        onSaved?.(partyId, name.trim());
      } else {
        const id = await createParty(getDb(), input);
        setSuccess("Party created.");
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
          <Label htmlFor="party-name">Party name</Label>
          <Input
            id="party-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Owner, Allied Bank, Imran (investor)"
            maxLength={120}
            required
            aria-invalid={!!error}
            aria-describedby={error ? alertId : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="party-phone">Phone (optional)</Label>
          <Input
            id="party-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+92…"
            maxLength={25}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="party-contact">Contact person (optional)</Label>
          <Input
            id="party-contact"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="e.g. Branch manager"
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="party-city">City / area (optional)</Label>
          <Input
            id="party-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Lahore"
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="party-address">Address (optional)</Label>
          <Input
            id="party-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Branch / street details"
            maxLength={300}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="party-notes">Notes (optional)</Label>
          <Input
            id="party-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Loan terms, relationship, anything worth remembering"
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
          {busy ? "Saving…" : isEditing ? "Update party" : "Create party"}
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
