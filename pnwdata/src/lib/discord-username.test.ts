import { describe, expect, it } from "vitest";
import { isLegacyDiscord, normalizeDiscord, resolveNationDiscord } from "./discord-username";

describe("normalizeDiscord", () => {
  it("strips trailing #0 discriminator", () => {
    expect(normalizeDiscord("player#0")).toBe("player");
    expect(normalizeDiscord("player")).toBe("player");
  });
});

describe("isLegacyDiscord", () => {
  it("detects legacy discriminators", () => {
    expect(isLegacyDiscord("user#1234")).toBe(true);
    expect(isLegacyDiscord("user#0")).toBe(false);
    expect(isLegacyDiscord("user#0000")).toBe(false);
    expect(isLegacyDiscord("modernuser")).toBe(false);
  });
});

describe("resolveNationDiscord", () => {
  it("prefers modern BK Net username", () => {
    expect(resolveNationDiscord("bkuser", "pnwuser")).toBe("bkuser");
  });

  it("uses PnW when BK Net is legacy", () => {
    expect(resolveNationDiscord("old#1234", "pnwuser")).toBe("pnwuser");
  });

  it("falls back to legacy BK Net when PnW is empty", () => {
    expect(resolveNationDiscord("old#1234", null)).toBe("old#1234");
  });

  it("returns null when neither source has a name", () => {
    expect(resolveNationDiscord(undefined, "")).toBeNull();
  });
});