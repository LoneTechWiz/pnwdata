import { describe, expect, it } from "vitest";
import { DAY_MS, recruitsIn, retentionFor, retentionPercent } from "./recruitment-stats";

const now = Date.UTC(2026, 5, 1);
const firstSnapshot = now - 120 * DAY_MS;

describe("recruitsIn", () => {
  it("counts joins within the window", () => {
    const rows = [
      { nation_id: 1, alliance_id: 1, join_date: now - 5 * DAY_MS, left_at: null },
      { nation_id: 2, alliance_id: 1, join_date: now - 40 * DAY_MS, left_at: null },
    ];
    expect(recruitsIn(rows, 7, now)).toBe(1);
    expect(recruitsIn(rows, 60, now)).toBe(2);
  });
});

describe("retentionFor", () => {
  it("counts members retained for full period", () => {
    const rows = [
      { nation_id: 1, alliance_id: 1, join_date: now - 60 * DAY_MS, left_at: null },
      { nation_id: 2, alliance_id: 1, join_date: now - 60 * DAY_MS, left_at: now - 55 * DAY_MS },
    ];
    const bucket = retentionFor(rows, 30, now, firstSnapshot);
    expect(bucket).toEqual({ numerator: 1, denominator: 2 });
    expect(retentionPercent(bucket)).toBe(0.5);
  });

  it("excludes joins before first snapshot", () => {
    const rows = [
      { nation_id: 1, alliance_id: 1, join_date: firstSnapshot - DAY_MS, left_at: null },
    ];
    const bucket = retentionFor(rows, 30, now, firstSnapshot);
    expect(bucket.denominator).toBe(0);
  });

  it("excludes cohorts that have not aged enough", () => {
    const rows = [
      { nation_id: 1, alliance_id: 1, join_date: now - 5 * DAY_MS, left_at: null },
    ];
    const bucket = retentionFor(rows, 30, now, firstSnapshot);
    expect(bucket.denominator).toBe(0);
  });
});

describe("retentionPercent", () => {
  it("returns null when denominator is zero", () => {
    expect(retentionPercent({ numerator: 0, denominator: 0 })).toBeNull();
  });
});