export function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatDate(ts: { toDate?: () => Date } | undefined): string {
  try {
    return ts?.toDate?.().toLocaleString() ?? "—";
  } catch {
    return "—";
  }
}
