import { config } from "./config.js";

export interface StockpileAlert {
  id: number;
  nation_id: number;
  nation_name: string;
  discord_username: string | null;
  discord_id: string | null;
  resource: string;
  amount: number;
  num_cities: number;
  threshold: number;
  created_at: number;
}

export interface WarTarget {
  id: number;
  nation_name: string;
  leader_name: string;
  alliance_name: string;
  score: number;
  num_cities: number;
  avg_infra: number;
  soldiers: number;
  aircraft: number;
  defensive_wars_count: number;
  beige_avg: number | null;
}

export interface WarTargetsResponse {
  targets: WarTarget[];
  minScore: number;
  maxScore: number;
  yourLeader: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.pnwdataUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.botServiceToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `pnwdata returned HTTP ${response.status}`);
  return payload as T;
}

export function updateDiscordLinks(links: Array<{ nationId: number; discordId: string; username: string }>): Promise<{ count: number }> {
  return request("/api/bot/discord-links", {
    method: "POST",
    body: JSON.stringify({ links }),
  });
}

export async function getStockpileAlerts(): Promise<StockpileAlert[]> {
  return (await request<{ alerts: StockpileAlert[] }>("/api/bot/stockpile-alerts")).alerts;
}

export function acknowledgeStockpileAlerts(ids: number[]): Promise<{ count: number }> {
  return request("/api/bot/stockpile-alerts", {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
}

export function getWarTargets(nationId: number): Promise<WarTargetsResponse> {
  return request(`/api/warTargets?nationId=${encodeURIComponent(String(nationId))}`);
}
