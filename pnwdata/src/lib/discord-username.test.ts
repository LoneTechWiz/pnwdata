import { describe, expect, it } from "vitest";
import { normalizeDiscord, resolveNationDiscord } from "./discord-username";

describe("normalizeDiscord", () => {
  it("strips trailing #0 discriminator", () => {
    expect(normalizeDiscord("player#0")).toBe("player");
    expect(normalizeDiscord("player")).toBe("player");
  });
});

describe("resolveNationDiscord", () => {
  it("uses and normalizes the P&W username", () => {
    expect(resolveNationDiscord("pnwuser#0")).toBe("pnwuser");
  });

  it("returns null when P&W has no username", () => {
    expect(resolveNationDiscord("")).toBeNull();
  });
});
