import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let GET: typeof import("./route").GET;

vi.mock("@/lib/supabase", () => ({
  readJsonRows: vi.fn(async (table: string) => table === "nations" ? [{ id: 42, nation_name: "Fixture Nation" }] : []),
  readJsonSingleton: vi.fn(async () => null),
  supabase: { from: vi.fn() },
}));

beforeEach(async () => {
  vi.resetModules();
  const route = await import("./route");
  GET = route.GET;
});

afterEach(() => {
  vi.resetModules();
});

describe("GET /api/data", () => {
  it("returns members from Supabase", async () => {
    const req = new NextRequest("http://localhost/api/data?type=members");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].nation_name).toBe("Fixture Nation");
  });

  it("returns 400 for unknown type", async () => {
    const req = new NextRequest("http://localhost/api/data?type=unknown");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Unknown type");
  });
});
