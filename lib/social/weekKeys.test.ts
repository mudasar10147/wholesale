import assert from "node:assert/strict";
import test from "node:test";
import {
  isoWeekKey,
  mondayOfWeekKey,
  shiftWeekKey,
  toDateKey,
  weekDates,
  weekdayKeyOf,
} from "./weekKeys.ts";

test("isoWeekKey pads the week number", () => {
  assert.equal(isoWeekKey(new Date(2026, 0, 8)), "2026-W02");
});

test("a week key round-trips through its Monday", () => {
  const monday = mondayOfWeekKey("2026-W29");
  assert.equal(weekdayKeyOf(monday), "mon");
  assert.equal(isoWeekKey(monday), "2026-W29");
  assert.equal(toDateKey(monday), "2026-07-13");
});

test("every day of a week maps back to that same week key", () => {
  for (const day of weekDates("2026-W29")) {
    assert.equal(isoWeekKey(day), "2026-W29");
  }
});

test("weekDates runs Monday through Sunday", () => {
  const days = weekDates("2026-W29");
  assert.equal(days.length, 7);
  assert.equal(weekdayKeyOf(days[0]!), "mon");
  assert.equal(weekdayKeyOf(days[6]!), "sun");
  assert.equal(toDateKey(days[6]!), "2026-07-19");
});

test("Jan 1 can belong to the final week of the previous ISO year", () => {
  // 2027-01-01 is a Friday, so ISO puts it in the last week of 2026.
  assert.equal(isoWeekKey(new Date(2027, 0, 1)), "2026-W53");
});

test("late December can belong to week 1 of the next ISO year", () => {
  // 2024-12-30 is a Monday; its Thursday falls in 2025.
  assert.equal(isoWeekKey(new Date(2024, 11, 30)), "2025-W01");
});

test("shiftWeekKey crosses the year boundary in both directions", () => {
  assert.equal(shiftWeekKey("2026-W52", 1), "2026-W53");
  assert.equal(shiftWeekKey("2026-W53", 1), "2027-W01");
  assert.equal(shiftWeekKey("2027-W01", -1), "2026-W53");
});

test("shifting forward and back returns the original week", () => {
  assert.equal(shiftWeekKey(shiftWeekKey("2026-W29", -2), 2), "2026-W29");
});

test("toDateKey uses the local calendar day, not UTC", () => {
  // Late-evening local time would roll forward a day under toISOString().
  assert.equal(toDateKey(new Date(2026, 6, 12, 23, 30)), "2026-07-12");
});
