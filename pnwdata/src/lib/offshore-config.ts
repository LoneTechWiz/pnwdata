import db from "./db";
import { gql, MY_NATION_QUERY } from "./sync";

export interface OffshoreAlliance {
  allianceId: number;
  allianceName: string;
  label: string | null;
  addedByDiscordId: string;
  addedByUsername: string;
  status: "pending" | "syncing" | "success" | "error";
  error: string | null;
  memberCount: number;
  warCount: number;
  bankrecCount: number;
  lastSyncedAt: number | null;
  createdAt: number;
}

interface OffshoreAllianceRow {
  alliance_id: number;
  alliance_name: string;
  label: string | null;
  api_key: string;
  added_by_discord_id: string;
  added_by_username: string;
  status: string;
  error: string | null;
  member_count: number;
  war_count: number;
  bankrec_count: number;
  last_synced_at: number | null;
  created_at: number;
}

function toPublic(row: OffshoreAllianceRow): OffshoreAlliance {
  return {
    allianceId: row.alliance_id,
    allianceName: row.alliance_name,
    label: row.label,
    addedByDiscordId: row.added_by_discord_id,
    addedByUsername: row.added_by_username,
    status: row.status as OffshoreAlliance["status"],
    error: row.error,
    memberCount: row.member_count,
    warCount: row.war_count,
    bankrecCount: row.bankrec_count,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

export function listOffshoreAlliances(): OffshoreAlliance[] {
  const rows = db.prepare("SELECT * FROM offshore_alliances ORDER BY created_at ASC").all() as OffshoreAllianceRow[];
  return rows.map(toPublic);
}

export function getOffshoreAllianceRow(allianceId: number): OffshoreAllianceRow | undefined {
  return db.prepare("SELECT * FROM offshore_alliances WHERE alliance_id = ?").get(allianceId) as OffshoreAllianceRow | undefined;
}

/** Calls the P&W API with the given key to confirm it's valid and resolve the owning alliance. */
export async function verifyApiKey(apiKey: string): Promise<{ allianceId: number; allianceName: string }> {
  const data = await gql<{ me: { nation: { alliance_id: string; alliance: { name: string } | null } } }>(
    MY_NATION_QUERY,
    undefined,
    apiKey,
  );
  const allianceId = Number(data.me.nation.alliance_id);
  if (!allianceId) throw new Error("This key's nation is not in an alliance");
  return { allianceId, allianceName: data.me.nation.alliance?.name ?? `Alliance #${allianceId}` };
}

export async function addOffshoreAlliance(params: {
  apiKey: string;
  label: string | null;
  discordId: string;
  username: string;
}): Promise<OffshoreAlliance> {
  const { allianceId, allianceName } = await verifyApiKey(params.apiKey);
  const now = Date.now();
  db.prepare(`
    INSERT INTO offshore_alliances (alliance_id, alliance_name, label, api_key, added_by_discord_id, added_by_username, status, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)
    ON CONFLICT(alliance_id) DO UPDATE SET
      alliance_name = excluded.alliance_name, label = excluded.label, api_key = excluded.api_key,
      added_by_discord_id = excluded.added_by_discord_id, added_by_username = excluded.added_by_username,
      status = 'pending', error = NULL
  `).run(allianceId, allianceName, params.label, params.apiKey, params.discordId, params.username, now);
  return toPublic(getOffshoreAllianceRow(allianceId)!);
}

export function removeOffshoreAlliance(allianceId: number): void {
  db.prepare("DELETE FROM offshore_alliances WHERE alliance_id = ?").run(allianceId);
}

/** `isAdmin` should already fold in isEmperor / role-config access to "/offshore-config". */
export function canManageOffshoreAlliance(
  row: Pick<OffshoreAllianceRow, "added_by_discord_id">,
  discordId: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || discordId === row.added_by_discord_id;
}
