import type { Client, Guild, Role } from "discord.js";

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminRole: string;
}

export interface DiscordOAuthResult {
  user: {
    id: string;
    username: string;
    avatar: string | null;
  };
  roleIds: string[];
  isAdmin: boolean;
}

export class DiscordOAuthError extends Error {
  constructor(
    public readonly code: "invalid_request" | "token_exchange" | "not_member" | "discord_unavailable",
    public readonly status: number,
  ) {
    super(code);
  }
}

export function buildDiscordAuthorizeUrl(state: string, oauth: Pick<DiscordOAuthConfig, "clientId" | "redirectUri">): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
    throw new DiscordOAuthError("invalid_request", 400);
  }

  const params = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export function memberHasAdminRole(
  roleIds: Iterable<string>,
  roles: Iterable<Pick<Role, "id" | "name">>,
  configuredRole: string,
): boolean {
  const memberRoles = new Set(roleIds);
  const isSnowflake = /^\d+$/.test(configuredRole);
  for (const role of roles) {
    if ((isSnowflake ? role.id === configuredRole : role.name === configuredRole) && memberRoles.has(role.id)) {
      return true;
    }
  }
  return false;
}

async function primaryGuild(client: Client, guildId: string): Promise<Guild> {
  return client.guilds.cache.get(guildId) ?? client.guilds.fetch(guildId);
}

export async function exchangeDiscordOAuth(
  client: Client,
  guildId: string,
  code: string,
  oauth: DiscordOAuthConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordOAuthResult> {
  if (!code || code.length > 4_096) {
    throw new DiscordOAuthError("invalid_request", 400);
  }

  const tokenResponse = await fetchImpl("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: oauth.redirectUri,
    }),
  }).catch(() => null);
  if (!tokenResponse?.ok) {
    throw new DiscordOAuthError("token_exchange", 401);
  }

  const tokenPayload = await tokenResponse.json().catch(() => null) as { access_token?: unknown } | null;
  if (typeof tokenPayload?.access_token !== "string" || !tokenPayload.access_token) {
    throw new DiscordOAuthError("token_exchange", 401);
  }

  const userResponse = await fetchImpl("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  }).catch(() => null);
  if (!userResponse?.ok) {
    throw new DiscordOAuthError("discord_unavailable", 502);
  }

  const user = await userResponse.json().catch(() => null) as {
    id?: unknown;
    username?: unknown;
    avatar?: unknown;
  } | null;
  if (typeof user?.id !== "string" || typeof user.username !== "string" ||
      (user.avatar !== null && typeof user.avatar !== "string")) {
    throw new DiscordOAuthError("discord_unavailable", 502);
  }

  const server = await primaryGuild(client, guildId).catch(() => null);
  if (!server) throw new DiscordOAuthError("discord_unavailable", 502);

  const member = await server.members.fetch(user.id).catch(() => null);
  if (!member) throw new DiscordOAuthError("not_member", 403);

  const roles = await server.roles.fetch().catch(() => null);
  if (!roles) throw new DiscordOAuthError("discord_unavailable", 502);
  const roleIds = [...member.roles.cache.keys()];

  return {
    user: { id: user.id, username: user.username, avatar: user.avatar },
    roleIds,
    isAdmin: memberHasAdminRole(roleIds, roles.values(), oauth.adminRole),
  };
}
