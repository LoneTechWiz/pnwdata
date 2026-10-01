import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  deleteRun: vi.fn(),
  insertRun: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    prepare: mocks.prepare,
    transaction: (callback: () => void) => callback,
  },
}));

import { POST } from "./route";

function request(body: unknown, token = "test-service-token") {
  return new NextRequest("http://localhost/api/bot/discord-links", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.BOT_SERVICE_TOKEN = "test-service-token";
  mocks.deleteRun.mockReset();
  mocks.insertRun.mockReset();
  mocks.prepare.mockReset();
  mocks.prepare.mockImplementation((sql: string) => ({
    run: sql.includes("DELETE FROM discord_nation_links") ? mocks.deleteRun : mocks.insertRun,
  }));
});

describe("POST /api/bot/discord-links", () => {
  it("requires the shared bot token", async () => {
    const response = await POST(request({ links: [] }, "wrong-token"));
    expect(response.status).toBe(401);
    expect(mocks.deleteRun).not.toHaveBeenCalled();
  });

  it("atomically replaces the nickname-derived nation links", async () => {
    const response = await POST(request({
      links: [
        { nationId: 526341, discordId: "123456789012345678", username: "LoneTechWiz" },
        { nationId: 987654, discordId: "234567890123456789", username: "AnotherMember" },
      ],
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 2 });
    expect(mocks.deleteRun).toHaveBeenCalledOnce();
    expect(mocks.insertRun).toHaveBeenNthCalledWith(1, 526341, "123456789012345678", "LoneTechWiz", expect.any(Number));
    expect(mocks.insertRun).toHaveBeenNthCalledWith(2, 987654, "234567890123456789", "AnotherMember", expect.any(Number));
  });

  it("rejects malformed links before changing the snapshot", async () => {
    const response = await POST(request({
      links: [{ nationId: 0, discordId: "not-a-discord-id", username: "" }],
    }));

    expect(response.status).toBe(400);
    expect(mocks.deleteRun).not.toHaveBeenCalled();
    expect(mocks.insertRun).not.toHaveBeenCalled();
  });
});
