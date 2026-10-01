import { describe, expect, it } from "vitest";
import { bankFlowSince, estimateLikelyLoot, estimateRevenueSince, inactiveDays, isEligibleRaidTarget } from "./raid-finder";
import type { BankRec, Nation } from "./pnw";

describe("raid finder calculations", () => {
  it("calculates fractional inactive days", () => {
    expect(inactiveDays("2026-01-08T12:00:00Z", Date.parse("2026-01-10T00:00:00Z"))).toBe(1.5);
  });

  it("uses an observed GNI baseline from before the beige", () => {
    const result = estimateRevenueSince(
      1_500,
      "2025-01-01T00:00:00Z",
      Date.parse("2026-01-05T00:00:00Z"),
      [{ grossNationalIncome: 1_000, capturedAt: Date.parse("2026-01-04T00:00:00Z") }],
      Date.parse("2026-01-10T00:00:00Z"),
    );
    expect(result).toEqual({ value: 500, basis: "observed" });
  });

  it("falls back to the recent snapshot rate", () => {
    const result = estimateRevenueSince(
      2_000,
      "2025-01-01T00:00:00Z",
      Date.parse("2026-01-05T00:00:00Z"),
      [
        { grossNationalIncome: 1_000, capturedAt: Date.parse("2026-01-08T00:00:00Z") },
        { grossNationalIncome: 1_200, capturedAt: Date.parse("2026-01-10T00:00:00Z") },
      ],
      Date.parse("2026-01-10T00:00:00Z"),
    );
    expect(result.basis).toBe("recent-rate");
    expect(result.value).toBe(500);
  });

  it("values visible bank inflows and outflows since beige", () => {
    const base = {
      id: 1, date: "2026-01-09T00:00:00Z", banker_id: 0, note: "", money: 100,
      coal: 0, oil: 0, uranium: 0, iron: 0, bauxite: 0, lead: 0, gasoline: 0,
      munitions: 0, steel: 0, aluminum: 0, food: 0, tax_id: 0, sender: null, receiver: null,
    } satisfies Omit<BankRec, "sender_id" | "sender_type" | "receiver_id" | "receiver_type">;
    const records: BankRec[] = [
      { ...base, sender_id: 9, sender_type: 2, receiver_id: 42, receiver_type: 1 },
      { ...base, id: 2, money: 30, sender_id: 42, sender_type: 1, receiver_id: 9, receiver_type: 2 },
    ];
    expect(bankFlowSince(42, Date.parse("2026-01-08T00:00:00Z"), records, null)).toEqual({ netValue: 70, recordCount: 2 });
  });

  it("weights the latest beige and adds ten percent of positive post-beige flow", () => {
    expect(estimateLikelyLoot([
      { beigeDate: 2, lootValue: 200 },
      { beigeDate: 1, lootValue: 100 },
    ], 1_000, -100)).toBe(275);
  });

  it("enforces score, inactivity, protection, slots, and exclusions", () => {
    const target = {
      id: 7, score: 1_000, last_active: "2026-01-01T00:00:00Z",
      vacation_mode_turns: 0, beige_turns: 0, defensive_wars_count: 1,
    } as Nation;
    const options = {
      requesterId: 1, minScore: 900, maxScore: 1_100, minInactiveDays: 7,
      excludedAllianceIds: new Set<number>(), allianceId: 99, atWarWith: new Set<number>(),
      now: Date.parse("2026-01-10T00:00:00Z"),
    };
    expect(isEligibleRaidTarget(target, options)).toBe(true);
    expect(isEligibleRaidTarget({ ...target, beige_turns: 2 }, options)).toBe(false);
    expect(isEligibleRaidTarget({ ...target, last_active: "2026-01-09T00:00:00Z" }, options)).toBe(false);
  });
});
