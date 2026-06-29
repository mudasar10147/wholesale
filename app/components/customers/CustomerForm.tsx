"use client";

import { useState, type FormEvent } from "react";
import { getDb } from "@/lib/firebase";
import { getFirestoreUserMessage } from "@/lib/firebase/errors";
import { createCustomer, updateCustomer } from "@/lib/firestore/customers";
import { Button } from "@/app/components/ui/Button";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s()-]*$/;

export type CustomerFormInitial = {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
};

type CustomerFormProps = {
  /** When set, the form updates this customer instead of creating a new one. */
  customerId?: string;
  initial?: CustomerFormInitial;
  /** Called after a successful create/update with the customer id and saved name. */
  onSaved?: (customerId: string, name: string) => void;
  onCancel?: () => void;
  alertId?: string;
};

function validate(input: { name: string; phone: string; email: string; address: string }): string | null {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const address = input.address.trim();

  if (!name) return "Customer name is required.";
  if (name.length < 2) return "Customer name must be at least 2 characters.";
  if (name.length > 120) return "Customer name must be 120 characters or fewer.";
  if (phone && (phone.length > 25 || !PHONE_RE.test(phone))) return "Enter a valid phone number.";
  if (email && (email.length > 120 || !EMAIL_RE.test(email))) return "Enter a valid email address.";
  if (address.length > 300) return "Address must be 300 characters or fewer.";
  return null;
}

export function CustomerForm({
  customerId,
  initial,
  onSaved,
  onCancel,
  alertId = "customer-form-alert",
}: CustomerFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isEditing = !!customerId;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const message = validate({ name, phone, email, address });
    if (message) {
      setError(message);
      return;
    }

    setBusy(true);
    try {
      if (customerId) {
        await updateCustomer(getDb(), customerId, { name, phone, email, address });
        setSuccess("Customer updated.");
        onSaved?.(customerId, name.trim());
      } else {
        await createCustomer(getDb(), { name, phone, email, address });
        setSuccess("Customer created.");
        setName("");
        setPhone("");
        setEmail("");
        setAddress("");
        onSaved?.("", name.trim());
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
          <Label htmlFor="customer-name">Customer name</Label>
          <Input
            id="customer-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Noor Electronics"
            maxLength={120}
            required
            aria-invalid={!!error}
            aria-describedby={error ? alertId : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-phone">Phone (optional)</Label>
          <Input
            id="customer-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+92…"
            maxLength={25}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-email">Email (optional)</Label>
          <Input
            id="customer-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
            maxLength={120}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="customer-address">Address (optional)</Label>
          <Input
            id="customer-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="City, area, shop details"
            maxLength={300}
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
          {busy ? "Saving…" : isEditing ? "Update customer" : "Create customer"}
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
