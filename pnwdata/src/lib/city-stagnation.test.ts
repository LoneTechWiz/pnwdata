import { describe, expect, it } from "vitest";
import { findStagnantNations, turnsSinceLastCity, TURN_MS } from "./city-stagnation";

const now = Date.parse("2026-10-06T00:00:00Z");
const ago = (turns: number) => new Date(now - turns * TURN_MS).toISOString();

describe("city stagnation", () => {
  it("uses the newest city date", () => {
    expect(turnsSinceLastCity({ cities: [{ date: ago(500) }, { date: ago(30) }] }, now)).toBe(30);
  });

  it("returns null without city dates", () => {
    expect(turnsSinceLastCity({ cities: [] }, now)).toBeNull();
    expect(turnsSinceLastCity({}, now)).toBeNull();
  });

  it("keeps only nations strictly over the threshold", () => {
    const result = findStagnantNations(
      [{ cities: [{ date: ago(120) }] }, { cities: [{ date: ago(121) }] }, {}],
      120,
      now,
    );
    expect(result.map((n) => n.turnsSinceCity)).toEqual([121]);
  });
});
