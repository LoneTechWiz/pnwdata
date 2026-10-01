import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: { prepare: mocks.prepare },
  readJsonRows: vi.fn((table: string) => (table === "nations" ? [{ id: 42, nation_name: "Fixture Nation" }] : [])),
  readJsonSingleton: vi.fn(() => null),
}));

import { GET } from "./route";

function request(type: string) {
  return new NextRequest(`http://localhost/api/data?type=${type}`);
}

beforeEach(() => {
  mocks.prepare.mockReset();
});

describe("GET /api/data", () => {
  it("returns members from SQLite", async () => {
    const res = await GET(request("members"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].nation_name).toBe("Fixture Nation");
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
