import type { Timestamp } from "firebase/firestore";
import { startOfLocalDay } from "@/lib/firestore/walkInSessions";

export type WalkInLineAmount = {
  quantity: number;
  unitSalePrice: number;
};

export type WalkInDailyTotal = {
  dateKey: string;
  label: string;
  total: number;
  sessionCount: number;
};

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lineTotal(line: WalkInLineAmount): number {
  return line.quantity * line.unitSalePrice;
}

export function sessionLinesTotal(lines: WalkInLineAmount[] | undefined): number {
  if (!lines?.length) return 0;
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

function saleDateKey(ts: Timestamp | undefined): string | null {
  if (!ts?.toDate) return null;
  return toDateKey(startOfLocalDay(ts.toDate()));
}

function formatDayCardLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "Today";
  const [y, mo, d] = dateKey.split("-").map(Number);
  const dayDate = new Date(y!, (mo ?? 1) - 1, d ?? 1);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === toDateKey(startOfLocalDay(yesterday))) return "Yesterday";
  return dayDate.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Approved walk-in totals grouped by business `sale_date`, newest day first.
 */
export function buildWalkInDailyTotals(
  sessions: Array<{ id: string; saleDate: Timestamp | undefined }>,
  linesBySession: Record<string, WalkInLineAmount[] | undefined>,
): WalkInDailyTotal[] {
  const byDay = new Map<string, { total: number; sessionCount: number }>();

  for (const session of sessions) {
    const key = saleDateKey(session.saleDate);
    if (!key) continue;
    const amount = sessionLinesTotal(linesBySession[session.id]);
    const cur = byDay.get(key) ?? { total: 0, sessionCount: 0 };
    byDay.set(key, {
      total: cur.total + amount,
      sessionCount: cur.sessionCount + 1,
    });
  }

  const todayKey = toDateKey(startOfLocalDay(new Date()));
  return [...byDay.entries()]
    .map(([dateKey, { total, sessionCount }]) => ({
      dateKey,
      label: formatDayCardLabel(dateKey, todayKey),
      total,
      sessionCount,
    }))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

/** Last N calendar days (including today), filling missing days with zero. */
export function buildRecentWalkInDailyTotals(
  sessions: Array<{ id: string; saleDate: Timestamp | undefined }>,
  linesBySession: Record<string, WalkInLineAmount[] | undefined>,
  dayCount = 7,
): WalkInDailyTotal[] {
  const fromData = buildWalkInDailyTotals(sessions, linesBySession);
  const byKey = new Map(fromData.map((row) => [row.dateKey, row]));
  const todayKey = toDateKey(startOfLocalDay(new Date()));
  const out: WalkInDailyTotal[] = [];

  for (let offset = 0; offset < dayCount; offset++) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const dateKey = toDateKey(startOfLocalDay(d));
    const existing = byKey.get(dateKey);
    out.push(
      existing ?? {
        dateKey,
        label: formatDayCardLabel(dateKey, todayKey),
        total: 0,
        sessionCount: 0,
      },
    );
  }

  return out;
}
