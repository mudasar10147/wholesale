"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { TraderDoc } from "@/lib/types/firestore";
import { AddTraderModal } from "@/app/components/traders/AddTraderModal";
import { Button } from "@/app/components/ui/Button";
import { Select } from "@/app/components/ui/Select";

type TraderRow = TraderDoc & { id: string };

type TraderSelectInputProps = {
  id: string;
  /** Selected trader id. */
  value: string;
  onChange: (traderId: string, traderName: string) => void;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export function TraderSelectInput({
  id,
  value,
  onChange,
  disabled = false,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: TraderSelectInputProps) {
  const [traders, setTraders] = useState<TraderRow[]>([]);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(getDb(), COLLECTIONS.traders), (snap) => {
      const next: TraderRow[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as TraderDoc;
        if (data.is_active !== false) next.push({ id: docSnap.id, ...data });
      });
      next.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));
      setTraders(next);
    });
    return () => unsub();
  }, []);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of traders) map.set(t.id, t.name);
    return map;
  }, [traders]);

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
        <option value="">Select trader…</option>
        {traders.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
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
        <AddTraderModal
          onDismiss={() => setShowModal(false)}
          onCreated={(traderId, name) => onChange(traderId, name)}
        />
      ) : null}
    </div>
  );
}
