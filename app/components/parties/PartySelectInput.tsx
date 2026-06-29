"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { PartyDoc } from "@/lib/types/firestore";
import { AddPartyModal } from "@/app/components/parties/AddPartyModal";
import { Button } from "@/app/components/ui/Button";
import { Select } from "@/app/components/ui/Select";

type PartyRow = PartyDoc & { id: string };

type PartySelectInputProps = {
  id: string;
  /** Selected party id. */
  value: string;
  onChange: (partyId: string, partyName: string) => void;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export function PartySelectInput({
  id,
  value,
  onChange,
  disabled = false,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: PartySelectInputProps) {
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(getDb(), COLLECTIONS.parties), (snap) => {
      const next: PartyRow[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as PartyDoc;
        if (data.is_active !== false) next.push({ id: docSnap.id, ...data });
      });
      next.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));
      setParties(next);
    });
    return () => unsub();
  }, []);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of parties) map.set(p.id, p.name);
    return map;
  }, [parties]);

  return (
    <div className="flex gap-2">
      <Select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => onChange(e.target.value, nameById.get(e.target.value) ?? "")}
      >
        <option value="">No party (optional)</option>
        {parties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        disabled={disabled}
        onClick={() => setShowModal(true)}
      >
        New
      </Button>

      {showModal ? (
        <AddPartyModal
          onDismiss={() => setShowModal(false)}
          onCreated={(partyId, name) => onChange(partyId, name)}
        />
      ) : null}
    </div>
  );
}
