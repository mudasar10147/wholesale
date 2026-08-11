"use client";

import { GLOSSARY } from "@/lib/bi/glossary";
import { BiCard, BiSection } from "@/app/components/bi/BiPrimitives";

const ORDER = [
  "gross_profit",
  "net_profit",
  "gross_margin",
  "markup",
  "expense_ratio",
  "inventory_turnover",
  "inventory_days",
  "working_capital",
  "purchasing_capacity",
  "cash_conversion_cycle",
  "receivable_days",
  "payable_days",
  "break_even",
  "margin_of_safety",
  "reinvestment",
  "confidence",
] as const;

export function GlossarySection() {
  return (
    <BiSection
      id="glossary"
      title="What these terms mean"
      description="Plain-language definitions, written for running a wholesale business rather than for an accountant."
    >
      <BiCard
        title="Financial terms used on this page"
        description="Margin and markup are not the same thing — a 13% gross margin is a 14.9% markup."
      >
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {ORDER.map((id) => {
            const term = GLOSSARY[id];
            return (
              <div key={term.id} className="border-b border-border pb-4 last:border-b-0 sm:last:border-b">
                <dt className="text-sm font-semibold text-foreground">{term.title}</dt>
                <dd className="mt-1 space-y-1.5">
                  <p className="text-sm leading-relaxed text-muted-foreground">{term.summary}</p>
                  {term.formula ? (
                    <p className="rounded bg-surface-muted px-2 py-1 font-mono text-xs leading-relaxed text-foreground">
                      {term.formula}
                    </p>
                  ) : null}
                  {term.why ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">{term.why}</p>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      </BiCard>
    </BiSection>
  );
}
