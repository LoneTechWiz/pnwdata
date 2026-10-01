import type { Nation, War, BankRec } from "./pnw";
import db, { readJsonRows, readJsonSingleton } from "./db";

interface OffshoreAllianceName {
  alliance_id: number;
  alliance_name: string;
}

function offshoreAllianceNames(): Map<number, string> {
  const rows = db.prepare("SELECT alliance_id, alliance_name FROM offshore_alliances").all() as OffshoreAllianceName[];
  return new Map(rows.map((row) => [row.alliance_id, row.alliance_name]));
}

function mainAlliance(): { id?: number; name?: string } {
  const meta = readJsonSingleton<{ id: number; name: string }>("alliance_meta");
  return { id: meta?.id, name: meta?.name };
}

/** Main alliance members plus every configured offshore/extension alliance's members, each tagged with its alliance. */
export function readAllNations(): Nation[] {
  const main = mainAlliance();
  const mainNations = readJsonRows<Nation>("nations").map((nation) => ({
    ...nation,
    alliance_id: main.id,
    alliance_name: main.name,
  }));

  const names = offshoreAllianceNames();
  const offshoreRows = db.prepare("SELECT alliance_id, data FROM offshore_nations").all() as Array<{ alliance_id: number; data: string }>;
  const offshoreNations = offshoreRows.map((row) => ({
    ...(JSON.parse(row.data) as Nation),
    alliance_id: row.alliance_id,
    alliance_name: names.get(row.alliance_id) ?? `Alliance #${row.alliance_id}`,
  }));

  return [...mainNations, ...offshoreNations];
}

/** Main alliance wars plus every configured offshore/extension alliance's wars, de-duplicated by war id. */
export function readAllWars(): War[] {
  const mainWars = readJsonRows<War>("wars");
  const offshoreRows = db.prepare("SELECT data FROM offshore_wars").all() as Array<{ data: string }>;
  const offshoreWars = offshoreRows.map((row) => JSON.parse(row.data) as War);

  const byId = new Map<number, War>();
  for (const war of [...mainWars, ...offshoreWars]) byId.set(war.id, war);
  return [...byId.values()];
}

/** Main alliance bank records plus every configured offshore/extension alliance's, each tagged with its alliance. */
export function readAllBankrecs(): BankRec[] {
  const main = mainAlliance();
  const mainRecs = readJsonRows<BankRec>("bankrecs").map((record) => ({
    ...record,
    alliance_id: main.id,
    alliance_name: main.name,
  }));

  const names = offshoreAllianceNames();
  const offshoreRows = db.prepare("SELECT alliance_id, data FROM offshore_bankrecs").all() as Array<{ alliance_id: number; data: string }>;
  const offshoreRecs = offshoreRows.map((row) => ({
    ...(JSON.parse(row.data) as BankRec),
    alliance_id: row.alliance_id,
    alliance_name: names.get(row.alliance_id) ?? `Alliance #${row.alliance_id}`,
  }));

  return [...mainRecs, ...offshoreRecs];
}
