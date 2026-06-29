"use client";

import { Input } from "@/app/components/ui/Input";
import { Label } from "@/app/components/ui/Label";
import { Select } from "@/app/components/ui/Select";

export type PricingFilterState = {
  search: string;
  category: string;
};

export const defaultPricingFilters: PricingFilterState = {
  search: "",
  category: "",
};

type PricingFiltersProps = {
  filters: PricingFilterState;
  categories: string[];
  onChange: (next: PricingFilterState) => void;
};

export function PricingFilters({ filters, categories, onChange }: PricingFiltersProps) {
  function patch(partial: Partial<PricingFilterState>) {
    onChange({ ...filters, ...partial });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
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
    </div>
  );
}
