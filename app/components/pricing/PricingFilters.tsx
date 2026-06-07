"use client";

import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";
import { cn } from "@/lib/utils";

export type PricingFilterState = {
  search: string;
  category: string;
  marginMin: string;
  marginMax: string;
  lowMarginOnly: boolean;
  outOfStockOnly: boolean;
  belowTargetOnly: boolean;
};

export const defaultPricingFilters: PricingFilterState = {
  search: "",
  category: "",
  marginMin: "",
  marginMax: "",
  lowMarginOnly: false,
  outOfStockOnly: false,
  belowTargetOnly: false,
};

type PricingFiltersProps = {
  filters: PricingFilterState;
  categories: string[];
  onChange: (next: PricingFilterState) => void;
};

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-surface text-muted-foreground hover:bg-surface-hover",
      )}
    >
      {label}
    </button>
  );
}

export function PricingFilters({ filters, categories, onChange }: PricingFiltersProps) {
  function patch(partial: Partial<PricingFilterState>) {
    onChange({ ...filters, ...partial });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="pricing-search">Search</Label>
          <Input
            id="pricing-search"
            placeholder="Product name or category"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pricing-category">Category</Label>
          <Select
            id="pricing-category"
            value={filters.category}
            onChange={(e) => patch({ category: e.target.value })}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="margin-min">Margin min %</Label>
            <Input
              id="margin-min"
              inputMode="decimal"
              placeholder="Min"
              value={filters.marginMin}
              onChange={(e) => patch({ marginMin: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="margin-max">Margin max %</Label>
            <Input
              id="margin-max"
              inputMode="decimal"
              placeholder="Max"
              value={filters.marginMax}
              onChange={(e) => patch({ marginMax: e.target.value })}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <FilterChip
          label="Low margin (&lt;8%)"
          active={filters.lowMarginOnly}
          onClick={() => patch({ lowMarginOnly: !filters.lowMarginOnly })}
        />
        <FilterChip
          label="Out of stock"
          active={filters.outOfStockOnly}
          onClick={() => patch({ outOfStockOnly: !filters.outOfStockOnly })}
        />
        <FilterChip
          label="Below target margin"
          active={filters.belowTargetOnly}
          onClick={() => patch({ belowTargetOnly: !filters.belowTargetOnly })}
        />
      </div>
    </div>
  );
}
