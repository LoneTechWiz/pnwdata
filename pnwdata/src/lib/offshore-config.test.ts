import { describe, expect, it, vi } from "vitest";

const fakeRow = {
  alliance_id: 1234,
  alliance_name: "Test Offshore",
  label: "My Offshore",
  api_key: "super-secret-pnw-key",
  added_by_discord_id: "111",
  added_by_username: "tester",
  status: "success",
  error: null,
  member_count: 10,
  war_count: 2,
  bankrec_count: 50,
  last_synced_at: 1700000000000,
  created_at: 1600000000000,
};

vi.mock("./db", () => ({
  default: {
    prepare: () => ({
      all: () => [fakeRow],
      get: () => fakeRow,
    }),
  },
}));

const { listOffshoreAlliances, canManageOffshoreAlliance } = await import("./offshore-config");

describe("listOffshoreAlliances", () => {
  it("never includes the raw API key anywhere in the response", () => {
    const [entry] = listOffshoreAlliances();

    expect(entry).not.toHaveProperty("api_key");
    expect(entry).not.toHaveProperty("apiKey");
    expect(JSON.stringify(entry)).not.toContain(fakeRow.api_key);
  });

  it("still exposes the non-secret fields", () => {
    const [entry] = listOffshoreAlliances();
    expect(entry).toMatchObject({
      allianceId: 1234,
      allianceName: "Test Offshore",
      label: "My Offshore",
      addedByUsername: "tester",
      status: "success",
    });
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
