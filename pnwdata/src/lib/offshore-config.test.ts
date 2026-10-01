import { describe, expect, it } from "vitest";
import { maskApiKey, canManageOffshoreAlliance } from "./offshore-config";

describe("maskApiKey", () => {
  it("keeps the first and last four characters of a normal key", () => {
    expect(maskApiKey("abcd1234efgh5678")).toBe("abcd••••5678");
  });

  it("fully masks short keys instead of leaking them", () => {
    expect(maskApiKey("short")).toBe("••••••••");
  });
});

describe("canManageOffshoreAlliance", () => {
  const row = { added_by_discord_id: "111" };

  it("allows the original submitter", () => {
    expect(canManageOffshoreAlliance(row, "111", false)).toBe(true);
  });

  it("allows admins regardless of who submitted it", () => {
    expect(canManageOffshoreAlliance(row, "999", true)).toBe(true);
  });

  it("denies other members", () => {
    expect(canManageOffshoreAlliance(row, "999", false)).toBe(false);
  });
});
