const REQUEST_TIMEOUT_MS = 15_000;

export interface DiscordGuildRole {
  id: string;
  name: string;
  color: number;
  position: number;
  isAdmin?: boolean;
}

export interface DiscordGuildMember {
  roles: string[];
  user: {
    id: string;
    username: string;
    avatar: string | null;
  };
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

async function darthRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.DARTH_PROTOCOL_URL?.replace(/\/$/, "");
  const token = process.env.BOT_SERVICE_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("DARTH_PROTOCOL_URL and BOT_SERVICE_TOKEN must be configured");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? `Darth Protocol returned HTTP ${response.status}`);
  }
  return payload as T;
}

export function getDiscordAuthorizeUrl(state: string): Promise<{ url: string }> {
  return darthRequest("/oauth/authorize", {
    method: "POST",
    body: JSON.stringify({ state }),
  });
}

export function exchangeDiscordOAuth(code: string): Promise<DiscordOAuthResult> {
  return darthRequest("/oauth/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function getDiscordGuildMember(userId: string): Promise<DiscordGuildMember> {
  return darthRequest(`/guild/members/${encodeURIComponent(userId)}`);
}

export function getDiscordGuildRoles(): Promise<DiscordGuildRole[]> {
  return darthRequest("/guild/roles");
}

export function sendDiscordDm(nationId: number, content: string): Promise<{ ok: true }> {
  return darthRequest("/dm", {
    method: "POST",
    body: JSON.stringify({ nationId, content }),
  });
}
