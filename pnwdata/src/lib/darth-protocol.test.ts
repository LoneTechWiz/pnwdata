import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeDiscordOAuth,
  getDiscordAuthorizeUrl,
  getDiscordGuildRoles,
  sendDiscordDm,
} from "./darth-protocol";

const originalUrl = process.env.DARTH_PROTOCOL_URL;
const originalToken = process.env.BOT_SERVICE_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.DARTH_PROTOCOL_URL;
  else process.env.DARTH_PROTOCOL_URL = originalUrl;
  if (originalToken === undefined) delete process.env.BOT_SERVICE_TOKEN;
  else process.env.BOT_SERVICE_TOKEN = originalToken;
});

describe("Darth Protocol client", () => {
  it("keeps Discord OAuth and guild selection behind the bot API", async () => {
    process.env.DARTH_PROTOCOL_URL = "http://darth-protocol:3100/";
    process.env.BOT_SERVICE_TOKEN = "shared-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://discord.com/oauth2/authorize" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: "1", username: "member", avatar: null },
        roleIds: ["2"],
        isAdmin: true,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await getDiscordAuthorizeUrl("0123456789abcdef0123456789abcdef");
    await exchangeDiscordOAuth("oauth-code");
    await getDiscordGuildRoles();
    await sendDiscordDm(526341, "hello");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://darth-protocol:3100/oauth/authorize",
      "http://darth-protocol:3100/oauth/exchange",
      "http://darth-protocol:3100/guild/roles",
      "http://darth-protocol:3100/dm",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers.Authorization).toBe("Bearer shared-secret");
    }
  });
});
