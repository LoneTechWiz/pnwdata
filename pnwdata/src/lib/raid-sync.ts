import db, { readJsonSingleton } from "./db";
import { attackLootBreakdown, type LootAttack, type TradePrices } from "./war-targets";

const PNW_API = "https://api.politicsandwar.com/graphql";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_BEIGE_HISTORY_DAYS = 31;

export interface RaidNation {
  id: number;
  nation_name: string;
  leader_name: string;
  alliance_id: number;
  alliance: { id: number; name: string } | null;
  score: number;
  num_cities: number;
  color: string;
  date: string;
  last_active: string;
  cities: { infrastructure: number }[];
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  offensive_wars_count: number;
  defensive_wars_count: number;
  vacation_mode_turns: number;
  beige_turns: number;
  gross_national_income: number;
  gross_domestic_product: number;
  money_looted: number;
}

interface BeigeWar {
  id: number;
  date: string;
  att_id: number;
  def_id: number;
  winner_id: number;
  attacks: LootAttack[];
}

const RAID_NATIONS_QUERY = `
  query($before:DateTime, $page:Int) {
    nations(active_before:$before, vmode:false, first:500, page:$page) {
      paginatorInfo { currentPage lastPage }
      data {
        id nation_name leader_name alliance_id score num_cities color date last_active
        alliance { id name }
        cities { infrastructure }
        soldiers tanks aircraft ships offensive_wars_count defensive_wars_count
        vacation_mode_turns beige_turns
        gross_national_income gross_domestic_product money_looted
      }
    }
  }
`;

const RAID_BEIGE_QUERY = `
  query($after:DateTime, $page:Int) {
    wars(active:false, after:$after, first:500, page:$page) {
      paginatorInfo { currentPage lastPage }
      data {
        id date att_id def_id winner_id
        attacks {
          type
          money_looted coal_looted oil_looted uranium_looted iron_looted bauxite_looted
          lead_looted gasoline_looted munitions_looted steel_looted aluminum_looted food_looted
        }
      }
    }
  }
`;

function apiDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 19).replace("T", " ");
}

async function gql<T>(query: string, variables: Record<string, unknown>, retries = 3): Promise<T> {
  const apiKey = process.env.PNW_API_KEY;
  if (!apiKey) throw new Error("PNW_API_KEY is not configured");
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(`${PNW_API}?api_key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 429 && attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`P&W API HTTP ${response.status}`);
    const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).join("; "));
    if (!json.data) throw new Error("P&W API returned no data");
    return json.data;
  }
  throw new Error("P&W API request failed after retries");
}

async function fetchInactiveNations(): Promise<RaidNation[]> {
  const before = apiDate(Date.now() - ONE_DAY_MS);
  const nations: RaidNation[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const result = await gql<{
      nations: { paginatorInfo: { lastPage: number }; data: RaidNation[] };
    }>(RAID_NATIONS_QUERY, { before, page });
    nations.push(...result.nations.data);
    lastPage = result.nations.paginatorInfo.lastPage;
    if (page === 1 || page % 5 === 0 || page === lastPage) {
      console.log(`[Raid Sync] Inactive nations page ${page}/${lastPage}`);
    }
    page += 1;
  } while (page <= lastPage);
  return nations;
}

async function fetchNewBeigeEvents(): Promise<BeigeWar[]> {
  const historyStart = Date.now() - INITIAL_BEIGE_HISTORY_DAYS * ONE_DAY_MS;
  const missingBreakdown = (db.prepare(`
    SELECT COUNT(*) AS count FROM raid_beige_events
    WHERE (nation_loot_value IS NULL OR alliance_loot_value IS NULL)
      AND beige_date >= ?
  `).get(historyStart) as { count: number }).count;
  const latest = db.prepare("SELECT MAX(beige_date) AS value FROM raid_beige_events")
    .get() as { value: number | null };
  const afterMs = latest.value == null || missingBreakdown > 0
    ? historyStart
    : latest.value - ONE_DAY_MS;
  const after = apiDate(afterMs);
  const wars: BeigeWar[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const result = await gql<{
      wars: { paginatorInfo: { lastPage: number }; data: BeigeWar[] };
    }>(RAID_BEIGE_QUERY, { after, page });
    wars.push(...result.wars.data);
    lastPage = result.wars.paginatorInfo.lastPage;
    if (lastPage > 200) throw new Error(`Unexpected beige history pagination size: ${lastPage} pages`);
    if (page === 1 || page % 5 === 0 || page === lastPage) {
      console.log(`[Raid Sync] Beige history page ${page}/${lastPage}`);
    }
    page += 1;
  } while (page <= lastPage);
  return wars;
}

export async function syncRaidIntelligence(): Promise<void> {
  console.log("[Raid Sync] Starting inactive nation and beige history sync…");
  db.prepare("UPDATE raid_sync_status SET status = 'syncing', error = NULL WHERE id = 1").run();
  try {
    const nations = await fetchInactiveNations();
    const now = Date.now();
    const snapshotDay = new Date(now).toISOString().slice(0, 10);
    const prices = readJsonSingleton<TradePrices>("trade_prices");
    const wars = await fetchNewBeigeEvents();
    const candidateIds = new Set(nations.map((nation) => Number(nation.id)));
    const existingEventsNeedingBreakdown = new Set(
      (db.prepare(`
        SELECT war_id, nation_id FROM raid_beige_events
        WHERE nation_loot_value IS NULL OR alliance_loot_value IS NULL
      `).all() as Array<{ war_id: number; nation_id: number }>)
        .map((row) => `${row.war_id}:${row.nation_id}`),
    );

    const insertNation = db.prepare("INSERT INTO raid_nations (id, data, updated_at) VALUES (?, ?, ?)");
    const insertIncome = db.prepare(`
      INSERT OR IGNORE INTO raid_income_snapshots
        (nation_id, snapshot_day, gross_national_income, captured_at)
      VALUES (?, ?, ?, ?)
    `);
    const insertBeige = db.prepare(`
      INSERT INTO raid_beige_events
        (war_id, nation_id, beige_date, loot_value, nation_loot_value, alliance_loot_value, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(war_id, nation_id) DO UPDATE SET
        beige_date = excluded.beige_date,
        loot_value = excluded.loot_value,
        nation_loot_value = excluded.nation_loot_value,
        alliance_loot_value = excluded.alliance_loot_value,
        recorded_at = excluded.recorded_at
    `);

    db.transaction(() => {
      db.prepare("DELETE FROM raid_nations").run();
      for (const nation of nations) {
        const nationId = Number(nation.id);
        insertNation.run(nationId, JSON.stringify(nation), now);
        insertIncome.run(nationId, snapshotDay, Number(nation.gross_national_income) || 0, now);
      }

      for (const war of wars) {
        const winnerId = Number(war.winner_id);
        if (!winnerId) continue;
        const attackerId = Number(war.att_id);
        const defenderId = Number(war.def_id);
        const loserId = winnerId === attackerId ? defenderId : attackerId;
        if (!candidateIds.has(loserId)
          && !existingEventsNeedingBreakdown.has(`${Number(war.id)}:${loserId}`)) continue;
        const beigeDate = Date.parse(war.date);
        if (!Number.isFinite(beigeDate)) continue;
        const breakdown = attackLootBreakdown(war.attacks ?? [], prices);
        insertBeige.run(
          Number(war.id),
          loserId,
          beigeDate,
          breakdown.nationLoot + breakdown.allianceLoot,
          breakdown.nationLoot,
          breakdown.allianceLoot,
          now,
        );
      }

      db.prepare("DELETE FROM raid_income_snapshots WHERE captured_at < ?")
        .run(now - 180 * ONE_DAY_MS);
      const beigeEventCount = (db.prepare("SELECT COUNT(*) AS count FROM raid_beige_events")
        .get() as { count: number }).count;
      db.prepare(`
        UPDATE raid_sync_status
        SET last_synced_at = ?, status = 'success', error = NULL,
            candidate_count = ?, beige_event_count = ?
        WHERE id = 1
      `).run(now, nations.length, beigeEventCount);
    })();

    console.log(`[Raid Sync] Done — ${nations.length} inactive nations, ${wars.length} recent wars checked`);
  } catch (error) {
    console.error("[Raid Sync] Failed:", error);
    db.prepare("UPDATE raid_sync_status SET status = 'error', error = ? WHERE id = 1")
      .run(String(error));
    throw error;
  }
}
