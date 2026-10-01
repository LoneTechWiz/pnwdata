import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Client, Guild } from "discord.js";
import { config } from "./config.js";
import { buildDiscordAuthorizeUrl, DiscordOAuthError, exchangeDiscordOAuth, memberHasAdminRole } from "./discord-oauth.js";
import { nationIdFromNickname } from "./watch.js";

function authorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization;
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied) return false;
  const expectedBytes = Buffer.from(config.botServiceToken);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
}

async function guild(client: Client, guildId: string): Promise<Guild> {
  return client.guilds.cache.get(guildId) ?? client.guilds.fetch(guildId);
}

function primaryGuildId(): string {
  if (!config.discordGuildId) throw new Error("DISCORD_GUILD_ID must be configured for website features");
  return config.discordGuildId;
}

async function guildRoles(client: Client, guildId: string, markAdmin = false) {
  const roles = await (await guild(client, guildId)).roles.fetch();
  return [...roles.values()].map((role) => ({
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    ...(markAdmin ? { isAdmin: memberHasAdminRole([role.id], [role], config.discordAdminRole) } : {}),
  }));
}

async function guildMember(client: Client, guildId: string, userId: string) {
  const member = await (await guild(client, guildId)).members.fetch(userId);
  return {
    roles: [...member.roles.cache.keys()],
    user: {
      id: member.user.id,
      username: member.user.username,
      avatar: member.user.avatar,
    },
  };
}

async function sendNationDm(client: Client, guildId: string, payload: { nationId?: unknown; content?: unknown }) {
  const nationId = Number(payload?.nationId);
  const content = typeof payload?.content === "string" ? payload.content.trim() : "";
  if (!Number.isSafeInteger(nationId) || nationId <= 0 || !content || content.length > 2_000) {
    throw new DiscordOAuthError("invalid_request", 400);
  }

  const members = await (await guild(client, guildId)).members.fetch();
  const member = members.find((candidate) => Number(nationIdFromNickname(candidate)) === nationId);
  if (!member) throw new Error(`Nation #${nationId} is not linked in a server nickname`);
  await member.send({ content, allowedMentions: { parse: [] } });
}

export function startBotApi(client: Client) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { ok: true, ready: client.isReady() });
        return;
      }
      if (!authorized(request)) {
        json(response, 401, { error: "Unauthorized" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/oauth/authorize") {
        const payload = await body(request) as { state?: unknown } | null;
        const state = typeof payload?.state === "string" ? payload.state : "";
        json(response, 200, {
          url: buildDiscordAuthorizeUrl(state, {
            clientId: config.discordClientId,
            redirectUri: config.discordRedirectUri,
          }),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/oauth/exchange") {
        const payload = await body(request) as { code?: unknown } | null;
        const code = typeof payload?.code === "string" ? payload.code : "";
        const result = await exchangeDiscordOAuth(client, primaryGuildId(), code, {
          clientId: config.discordClientId,
          clientSecret: config.discordClientSecret,
          redirectUri: config.discordRedirectUri,
          adminRole: config.discordAdminRole,
        });
        json(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/guild/roles") {
        json(response, 200, await guildRoles(client, primaryGuildId(), true));
        return;
      }

      const primaryMemberMatch = /^\/guild\/members\/(\d+)$/.exec(url.pathname);
      if (request.method === "GET" && primaryMemberMatch) {
        json(response, 200, await guildMember(client, primaryGuildId(), primaryMemberMatch[1]));
        return;
      }

      if (request.method === "POST" && url.pathname === "/dm") {
        await sendNationDm(client, primaryGuildId(), await body(request) as { nationId?: unknown; content?: unknown });
        json(response, 200, { ok: true });
        return;
      }

      const rolesMatch = /^\/guilds\/(\d+)\/roles$/.exec(url.pathname);
      if (request.method === "GET" && rolesMatch) {
        json(response, 200, await guildRoles(client, rolesMatch[1]));
        return;
      }

      const memberMatch = /^\/guilds\/(\d+)\/members\/(\d+)$/.exec(url.pathname);
      if (request.method === "GET" && memberMatch) {
        json(response, 200, await guildMember(client, memberMatch[1], memberMatch[2]));
        return;
      }

      const dmMatch = /^\/guilds\/(\d+)\/dm$/.exec(url.pathname);
      if (request.method === "POST" && dmMatch) {
        await sendNationDm(client, dmMatch[1], await body(request) as { nationId?: unknown; content?: unknown });
        json(response, 200, { ok: true });
        return;
      }

      json(response, 404, { error: "Not found" });
    } catch (error) {
      console.error("[Bot API] Request failed:", error);
      if (error instanceof DiscordOAuthError) {
        json(response, error.status, { error: error.code });
        return;
      }
      if (error instanceof Error && error.message.includes("is not linked")) {
        json(response, 404, { error: error.message });
        return;
      }
      json(response, 502, { error: error instanceof Error ? error.message : "Bot API request failed" });
    }
  });

  server.listen(config.httpPort, config.httpHost, () => {
    console.log(`[Bot API] Listening on http://${config.httpHost}:${config.httpPort}`);
  });
  return server;
}
