import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client } from "discord.js";
import { buildDiscordAuthorizeUrl, DiscordOAuthError, exchangeDiscordOAuth, memberHasAdminRole } from "../src/discord-oauth.js";

test("OAuth authorization URL is built inside the bot service", () => {
  const url = new URL(buildDiscordAuthorizeUrl("0123456789abcdef0123456789abcdef", {
    clientId: "application-id",
    redirectUri: "https://pnw.example/api/auth/callback",
  }));
  assert.equal(url.origin, "https://discord.com");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), "application-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://pnw.example/api/auth/callback");
  assert.equal(url.searchParams.get("scope"), "identify");
  assert.equal(url.searchParams.get("state"), "0123456789abcdef0123456789abcdef");
});

test("OAuth state rejects malformed values", () => {
  assert.throws(
    () => buildDiscordAuthorizeUrl("too short", { clientId: "id", redirectUri: "https://pnw.example/callback" }),
    (error) => error instanceof DiscordOAuthError && error.code === "invalid_request",
  );
});

test("admin membership supports both role names and role IDs", () => {
  const roles = [
    { id: "100", name: "Member" },
    { id: "200", name: "Emperor" },
  ];
  assert.equal(memberHasAdminRole(["200"], roles, "Emperor"), true);
  assert.equal(memberHasAdminRole(["200"], roles, "200"), true);
  assert.equal(memberHasAdminRole(["100"], roles, "Emperor"), false);
});

test("OAuth exchange returns only safe identity and guild authorization data", async () => {
  const roles = new Map([
    ["100", { id: "100", name: "Member" }],
    ["200", { id: "200", name: "Emperor" }],
  ]);
  const server = {
    members: {
      fetch: async (id: string) => ({
        user: { id, username: "member", avatar: null },
        roles: { cache: new Map([["100", {}], ["200", {}]]) },
      }),
    },
    roles: { fetch: async () => roles },
  };
  const client = {
    guilds: {
      cache: new Map([["guild", server]]),
      fetch: async () => server,
    },
  } as unknown as Client;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "private-access-token" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "42", username: "member", avatar: null }), { status: 200 });
  };

  const result = await exchangeDiscordOAuth(client, "guild", "one-time-code", {
    clientId: "application-id",
    clientSecret: "client-secret",
    redirectUri: "https://pnw.example/api/auth/callback",
    adminRole: "Emperor",
  }, fetchImpl);

  assert.deepEqual(result, {
    user: { id: "42", username: "member", avatar: null },
    roleIds: ["100", "200"],
    isAdmin: true,
  });
  assert.equal(JSON.stringify(result).includes("private-access-token"), false);
  assert.equal(requests[1].init?.headers && (requests[1].init.headers as Record<string, string>).Authorization, "Bearer private-access-token");
});
