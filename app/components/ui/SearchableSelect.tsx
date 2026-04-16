"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Input } from "@/app/components/ui/Input";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  id: string;
  searchText: string;
};

type SearchableSelectProps<T extends SearchableOption> = {
  options: T[];
  value: string;
  onChange: (id: string) => void;
  getDisplayValue: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
};

export function SearchableSelect<T extends SearchableOption>({
  options,
  value,
  onChange,
  getDisplayValue,
  renderOption,
  placeholder = "Search...",
  emptyText = "No matches found.",
  disabled = false,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
}: SearchableSelectProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) => option.searchText.includes(normalizedQuery));
  }, [normalizedQuery, options]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, normalizedQuery]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function choose(option: T) {
    onChange(option.id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      }
      return;
    }
    if (event.key === "Enter") {
      if (open && filtered.length > 0) {
        event.preventDefault();
        const target = filtered[activeIndex] ?? filtered[0];
        if (target) choose(target);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  const inputValue = open ? query : selected ? getDisplayValue(selected) : "";

  return (
    <div ref={rootRef} className="relative">
      <Input
        value={inputValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            filtered.map((option, index) => {
              const isActive = index === activeIndex;
              const isSelected = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    "w-full rounded-md px-2 py-2 text-left text-sm",
                    isActive ? "bg-surface-hover" : "hover:bg-surface-hover",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  {renderOption(option)}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
