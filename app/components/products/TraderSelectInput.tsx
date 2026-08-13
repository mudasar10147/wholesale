"use client";

import { useMemo, useState } from "react";
import { useTraders } from "@/lib/firestore/referenceData";
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
  const { rows: traderRows } = useTraders();
  const [showModal, setShowModal] = useState(false);

  const traders = useMemo<TraderRow[]>(() => {
    const next: TraderRow[] = [];
    for (const { id: traderId, data } of traderRows) {
      if (data.is_active !== false) next.push({ id: traderId, ...data });
    }
    next.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));
    return next;
  }, [traderRows]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of traders) map.set(t.id, t.name);
    return map;
  }, [traders]);

  return (
    <div className="space-y-1.5">
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
      </div>
      {traders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No traders yet. Add one from the Traders page.</p>
      ) : null}

      {showModal ? (
        <AddTraderModal
          onDismiss={() => setShowModal(false)}
          onCreated={(traderId, name) => onChange(traderId, name)}
        />
      ) : null}
    </div>
  );
}
