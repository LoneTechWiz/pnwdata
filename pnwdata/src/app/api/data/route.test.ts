import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: { prepare: mocks.prepare },
  readJsonRows: vi.fn((table: string) => (table === "applicants" ? [{ id: 7, nation_name: "Fixture Applicant" }] : [])),
  readJsonSingleton: vi.fn(() => null),
}));

vi.mock("@/lib/merged-data", () => ({
  readAllNations: vi.fn(() => [{ id: 42, nation_name: "Fixture Nation", alliance_name: "Main Alliance" }]),
  readAllWars: vi.fn(() => [{ id: 1, nation_name: "Fixture War" }]),
  readAllBankrecs: vi.fn(() => [{ id: 2, amount: 100 }]),
}));

import { GET } from "./route";

function request(type: string) {
  return new NextRequest(`http://localhost/api/data?type=${type}`);
}

beforeEach(() => {
  mocks.prepare.mockReset();
});

describe("GET /api/data", () => {
  it("returns the merged (main + offshore) member list for type=members", async () => {
    const res = await GET(request("members"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([
      { id: 42, nation_name: "Fixture Nation", alliance_name: "Main Alliance" },
    ]);
  });

  it("returns the merged war list for type=wars", async () => {
    const res = await GET(request("wars"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([{ id: 1, nation_name: "Fixture War" }]);
  });

  it("returns the merged bank record list for type=bankrecs", async () => {
    const res = await GET(request("bankrecs"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([{ id: 2, amount: 100 }]);
  });

  it("returns applicants from the main alliance only", async () => {
    const res = await GET(request("applicants"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([{ id: 7, nation_name: "Fixture Applicant" }]);
  });

  it("maps discord_nation_links rows into a nation-id-keyed record", async () => {
    mocks.prepare.mockReturnValue({
      all: () => [{ nation_id: 526341, discord_id: "123", username: "LoneTechWiz" }],
    });

    const res = await GET(request("discord_links"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      526341: { discordId: "123", username: "LoneTechWiz" },
    });
  });

  it("returns the sync_status row for type=status", async () => {
    mocks.prepare.mockReturnValue({
      get: () => ({ id: 1, status: "success", last_synced_at: 123, member_count: 5 }),
    });

    const res = await GET(request("status"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: 1, status: "success", last_synced_at: 123, member_count: 5 });
  });

  it("returns 400 for an unknown type", async () => {
    const res = await GET(request("unknown"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Unknown type" });
  });
});
