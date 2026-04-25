"use client";

import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { Input } from "@/app/components/ui/Input";
import { cn } from "@/lib/utils";

type CategorySuggestInputProps = {
  id: string;
  name?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

const MAX_SUGGESTIONS = 40;

export function CategorySuggestInput({
  id,
  name,
  value,
  onChange,
  placeholder = "Type or pick a category",
  disabled = false,
  maxLength = 120,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: CategorySuggestInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDocs(collection(getDb(), COLLECTIONS.products));
        const set = new Set<string>();
        snap.forEach((docSnap) => {
          const raw = docSnap.data().category;
          if (typeof raw === "string") {
            const t = raw.trim();
            if (t) set.add(t);
          }
        });
        const list = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        if (!cancelled) setSuggestions(list);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions.slice(0, MAX_SUGGESTIONS);
    return suggestions
      .filter((c) => c.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, value]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const showList = open && !disabled && filtered.length > 0;

  return (
    <div ref={rootRef} className="relative">
      <Input
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-expanded={showList}
        role="combobox"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e: FocusEvent<HTMLInputElement>) => {
          const next = e.relatedTarget as Node | null;
          if (next && rootRef.current?.contains(next)) return;
          setOpen(false);
        }}
      />
      {showList ? (
        <ul
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
          role="listbox"
        >
          {filtered.map((c) => (
            <li key={c} role="presentation">
              <button
                type="button"
                tabIndex={-1}
                role="option"
                aria-selected={c === value}
                className={cn(
                  "w-full px-3 py-2 text-left text-sm text-foreground",
                  "hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
