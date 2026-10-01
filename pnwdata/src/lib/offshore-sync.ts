import type { Nation, War, BankRec, Alliance } from "./pnw";
import db from "./db";
import { gql, ALLIANCE_QUERY, MEMBERS_QUERY, WARS_QUERY, BANK_RECS_QUERY, TAX_QUERY } from "./sync";
import { listOffshoreAlliances, getOffshoreAllianceRow } from "./offshore-config";
import { upsertTaxBrackets, replaceTaxRecords, type RawTaxBracket, type RawTaxRecord } from "./tax-revenue";

function replaceOffshoreSnapshot<T>(
  table: "offshore_nations" | "offshore_wars" | "offshore_bankrecs",
  allianceId: number,
  items: T[],
  idFor: (item: T) => string | number,
  now: number,
): void {
  const insert = db.prepare(`INSERT INTO ${table} (alliance_id, id, data, updated_at) VALUES (?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${table} WHERE alliance_id = ?`).run(allianceId);
    for (const item of items) insert.run(allianceId, idFor(item), JSON.stringify(item), now);
  })();
}

export async function syncOffshoreAlliance(allianceId: number): Promise<void> {
  const row = getOffshoreAllianceRow(allianceId);
  if (!row) return;

  db.prepare("UPDATE offshore_alliances SET status = 'syncing', error = NULL WHERE alliance_id = ?").run(allianceId);

  try {
    const [allianceData, membersData, warsData, bankData, taxData] = await Promise.all([
      gql<{ alliances: { data: Alliance[] } }>(ALLIANCE_QUERY, { id: [allianceId] }, row.api_key),
      gql<{ nations: { data: Nation[] } }>(MEMBERS_QUERY, { alliance_id: [allianceId] }, row.api_key),
      gql<{ wars: { data: War[] } }>(WARS_QUERY, { alliance_id: [allianceId] }, row.api_key),
      gql<{ bankrecs: { data: BankRec[] } }>(BANK_RECS_QUERY, { or_id: [allianceId], first: 500 }, row.api_key),
      gql<{ alliances: { data: Array<{ tax_brackets: RawTaxBracket[] | null; taxrecs: RawTaxRecord[] | null }> } }>(TAX_QUERY, { id: [allianceId], limit: 2000 }, row.api_key),
    ]);

    const now = Date.now();
    const nations = membersData.nations.data.filter((nation) => nation.alliance_position !== "APPLICANT");
    const wars = warsData.wars.data;
    const bankrecs = bankData.bankrecs.data;
    const alliance = allianceData.alliances.data[0];

    if (alliance) {
      const allianceWithCount = { ...alliance, member_count: nations.length };
      db.prepare("INSERT OR REPLACE INTO offshore_alliance_meta (alliance_id, data, updated_at) VALUES (?, ?, ?)")
        .run(allianceId, JSON.stringify(allianceWithCount), now);
    }

    replaceOffshoreSnapshot("offshore_nations", allianceId, nations, (nation) => nation.id, now);
    replaceOffshoreSnapshot("offshore_wars", allianceId, wars, (war) => war.id, now);
    replaceOffshoreSnapshot("offshore_bankrecs", allianceId, bankrecs, (record) => record.id, now);

    const taxAlliance = taxData.alliances.data[0];
    if (taxAlliance?.tax_brackets) upsertTaxBrackets(allianceId, taxAlliance.tax_brackets, now);
    if (taxAlliance?.taxrecs) replaceTaxRecords("offshore_tax_records", allianceId, taxAlliance.taxrecs, now);

    db.prepare(`
      UPDATE offshore_alliances
      SET status = 'success', error = NULL, last_synced_at = ?,
          alliance_name = ?, member_count = ?, war_count = ?, bankrec_count = ?
      WHERE alliance_id = ?
    `).run(now, alliance?.name ?? row.alliance_name, nations.length, wars.length, bankrecs.length, allianceId);

    console.log(`[Offshore Sync] ${row.alliance_name} (${allianceId}) — ${nations.length} members, ${wars.length} wars, ${bankrecs.length} bank recs`);
  } catch (error) {
    console.error(`[Offshore Sync] ${row.alliance_name} (${allianceId}) failed:`, error);
    db.prepare("UPDATE offshore_alliances SET status = 'error', error = ? WHERE alliance_id = ?")
      .run(String(error), allianceId);
  }
}

export async function syncAllOffshoreAlliances(): Promise<void> {
  const entries = listOffshoreAlliances();
  for (const entry of entries) {
    await syncOffshoreAlliance(entry.allianceId);
  }
}

const globalState = globalThis as typeof globalThis & { _offshoreSyncStarted?: boolean };
const OFFSHORE_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export function startOffshoreSyncLoop(): void {
  if (globalState._offshoreSyncStarted) return;
  globalState._offshoreSyncStarted = true;

  syncAllOffshoreAlliances().catch((error) => console.error("[Offshore Sync] Initial run failed:", error));
  setInterval(
    () => syncAllOffshoreAlliances().catch((error) => console.error("[Offshore Sync] Periodic run failed:", error)),
    OFFSHORE_SYNC_INTERVAL_MS,
  );
}
