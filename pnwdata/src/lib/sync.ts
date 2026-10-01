import type { Nation, War, BankRec, Alliance } from "./pnw";
import { resolveNationDiscord } from "./discord-username";
import { exceedsStockpileThreshold } from "./stockpile";
import db from "./db";
import { readAppConfig } from "./app-config";
import { processSyncRequest } from "./sync-request";
import { syncRaidIntelligence } from "./raid-sync";

interface StockpileAlertConfig {
  enabled: boolean;
  thresholds: Record<string, number | null>;
}

async function readStockpileAlertConfig(): Promise<StockpileAlertConfig | null> {
  try {
    return await readAppConfig<StockpileAlertConfig>("stockpile-alert-config");
  } catch {
    return null;
  }
}

const ALERT_RESOURCES = ["money", "coal", "oil", "uranium", "iron", "bauxite", "lead", "gasoline", "munitions", "steel", "aluminum", "food"] as const;

const PNW_API = "https://api.politicsandwar.com/graphql";

const MY_NATION_QUERY = `{ me { nation { alliance_id } } }`;

const ALLIANCE_QUERY = `
  query($id:[Int]) { alliances(id:$id) { data {
    id name acronym score color rank average_score flag forum_link discord_link
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food
  } } }
`;

const MEMBERS_QUERY = `
  query($alliance_id:[Int]) { nations(alliance_id:$alliance_id, first:500) { data {
    id nation_name leader_name discord score num_cities population color last_active continent
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food credits
    soldiers tanks aircraft ships missiles nukes spies
    vacation_mode_turns beige_turns alliance_position
    war_policy domestic_policy offensive_wars_count defensive_wars_count
    cities { date powered infrastructure land barracks factory hangar drydock hospital policestation recycling_center subway }
    mass_irrigation international_trade_center telecommunications_satellite uranium_enrichment_program
    iron_works bauxite_works arms_stockpile emergency_gasoline_reserve
    green_technologies clinical_research_center specialized_police_training_program
    recycling_initiative fallout_shelter government_support_agency bureau_of_domestic_affairs
    central_intelligence_agency center_for_civil_engineering advanced_engineering_corps arable_land_agency
  } } }
`;

const WARS_QUERY = `
  query($alliance_id:[Int]) { wars(alliance_id:$alliance_id, active:true, first:1000) { data {
    id date reason war_type turns_left
    att_id att_alliance_id
    def_id def_alliance_id
    attacker { nation_name leader_name alliance { name } soldiers tanks aircraft ships spies }
    defender { nation_name leader_name alliance { name } soldiers tanks aircraft ships spies }
    att_points def_points att_peace def_peace
    att_resistance def_resistance
    ground_control air_superiority naval_blockade
  } } }
`;

const BANK_RECS_QUERY = `
  query($or_id:[Int], $first:Int) { bankrecs(or_id:$or_id, or_type:[2], first:$first) { data {
    id date sender_id sender_type receiver_id receiver_type banker_id note
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food tax_id
    sender { nation_name }
    receiver { nation_name }
  } } }
`;

const TRADE_PRICES_QUERY = `
  { tradeprices(first:1) { data {
    id date coal oil uranium iron bauxite lead gasoline munitions steel aluminum food credits
  } } }
`;

const GAME_INFO_QUERY = `
  { game_info { game_date radiation { global north_america south_america europe africa asia australia } } }
`;

const ALL_MEMBERSHIPS_QUERY = `
  query($page:Int) { nations(first:500, page:$page) {
    paginatorInfo { currentPage lastPage }
    data { id alliance_id alliance_join_date }
  } }
`;

const ALL_ALLIANCES_QUERY = `
  query($page:Int) { alliances(first:50, page:$page) {
    paginatorInfo { currentPage lastPage }
    data { id name acronym score color rank }
  } }
`;

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.PNW_API_KEY;
  if (!apiKey) throw new Error("PNW_API_KEY is not configured");
  const response = await fetch(`${PNW_API}?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`P&W API HTTP ${response.status}`);
  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).join("; "));
  if (!json.data) throw new Error("P&W API returned no data");
  return json.data;
}

function replaceJsonSnapshot<T>(table: "nations" | "applicants" | "wars", items: T[], idFor: (item: T) => string | number, now: number): void {
  const insert = db.prepare(`INSERT INTO ${table} (id, data, updated_at) VALUES (?, ?, ?)`);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${table}`).run();
    for (const item of items) insert.run(idFor(item), JSON.stringify(item), now);
  })();
}

export async function sync(): Promise<void> {
  console.log("[PnW Sync] Starting sync…");
  db.prepare("UPDATE sync_status SET status = 'syncing', error = NULL WHERE id = 1").run();

  try {
    const meData = await gql<{ me: { nation: { alliance_id: string } } }>(MY_NATION_QUERY);
    const allianceId = Number(meData.me.nation.alliance_id);
    if (!allianceId) throw new Error("Could not determine alliance ID from API key");

    const [allianceData, membersData, warsData, bankData, tradePricesData, gameInfoData] = await Promise.all([
      gql<{ alliances: { data: Alliance[] } }>(ALLIANCE_QUERY, { id: [allianceId] }),
      gql<{ nations: { data: Nation[] } }>(MEMBERS_QUERY, { alliance_id: [allianceId] }),
      gql<{ wars: { data: War[] } }>(WARS_QUERY, { alliance_id: [allianceId] }),
      gql<{ bankrecs: { data: BankRec[] } }>(BANK_RECS_QUERY, { or_id: [allianceId], first: 500 }),
      gql<{ tradeprices: { data: unknown[] } }>(TRADE_PRICES_QUERY),
      gql<{ game_info: { game_date?: string; radiation: Record<string, number> } }>(GAME_INFO_QUERY),
    ]);

    const now = Date.now();
    const applicants = membersData.nations.data.filter((nation) => nation.alliance_position === "APPLICANT");
    const nations = membersData.nations.data.filter((nation) => nation.alliance_position !== "APPLICANT");
    const wars = warsData.wars.data;
    const bankrecs = bankData.bankrecs.data;
    const alliance = allianceData.alliances.data[0];

    db.transaction(() => {
      if (alliance) {
        const allianceWithCount = { ...alliance, member_count: nations.length };
        db.prepare("INSERT OR REPLACE INTO alliance_meta (id, data, updated_at) VALUES (1, ?, ?)")
          .run(JSON.stringify(allianceWithCount), now);
      }

      const latestPrice = tradePricesData.tradeprices.data[0];
      if (latestPrice) {
        db.prepare("INSERT OR REPLACE INTO trade_prices (id, data, updated_at) VALUES (1, ?, ?)")
          .run(JSON.stringify(latestPrice), now);
      }

      db.prepare("INSERT OR REPLACE INTO game_info (id, data, updated_at) VALUES (1, ?, ?)")
        .run(JSON.stringify(gameInfoData.game_info), now);
    })();

    replaceJsonSnapshot("nations", nations, (nation) => nation.id, now);
    replaceJsonSnapshot("applicants", applicants, (nation) => nation.id, now);
    replaceJsonSnapshot("wars", wars, (war) => war.id, now);

    const upsertBankRecord = db.prepare("INSERT OR REPLACE INTO bankrecs (id, data, updated_at) VALUES (?, ?, ?)");
    db.transaction(() => {
      for (const record of bankrecs) upsertBankRecord.run(record.id, JSON.stringify(record), now);
    })();

    const alertConfig = await readStockpileAlertConfig();
    if (alertConfig?.enabled) {
      db.prepare("DELETE FROM stockpile_alert_queue WHERE sent = 1 AND sent_at < ?")
        .run(now - 7 * 24 * 60 * 60 * 1000);

      const linkRows = db.prepare(
        "SELECT nation_id, discord_id, username FROM discord_nation_links",
      ).all() as Array<{ nation_id: number; discord_id: string; username: string }>;
      const discordLinks = new Map(linkRows.map((row) => [row.nation_id, row]));

      const blockadedIds = new Set<number>();
      for (const war of wars as Array<War & { naval_blockade: number; att_id: number; def_id: number }>) {
        if (!war.naval_blockade) continue;
        if (war.naval_blockade === war.att_id) blockadedIds.add(war.def_id);
        else if (war.naval_blockade === war.def_id) blockadedIds.add(war.att_id);
      }

      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const recentAlert = db.prepare("SELECT id FROM stockpile_alert_queue WHERE nation_id = ? AND created_at > ? LIMIT 1");
      const insertAlert = db.prepare(`
        INSERT INTO stockpile_alert_queue
          (nation_id, nation_name, discord_username, discord_id, resource, amount, num_cities, threshold, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      db.transaction(() => {
        for (const nation of nations) {
          if (nation.vacation_mode_turns > 0 || recentAlert.get(nation.id, oneDayAgo)) continue;

          const link = discordLinks.get(nation.id);
          const discord = link?.username ?? resolveNationDiscord(nation.discord);
          const discordId = link?.discord_id ?? null;
          const isBlockaded = blockadedIds.has(nation.id);

          for (const resource of ALERT_RESOURCES) {
            if (isBlockaded && resource !== "money") continue;
            const threshold = alertConfig.thresholds[resource];
            if (threshold == null) continue;
            const amount = (nation[resource as keyof Nation] as number) ?? 0;
            if (!exceedsStockpileThreshold(amount, threshold, resource, nation.num_cities)) continue;
            insertAlert.run(nation.id, nation.nation_name, discord, discordId, resource, amount, nation.num_cities, threshold, now);
          }
        }
      })();
    }

    db.prepare(`
      UPDATE sync_status
      SET last_synced_at = ?, status = 'success', error = NULL,
          member_count = ?, war_count = ?, bankrec_count = ?
      WHERE id = 1
    `).run(now, nations.length, wars.length, bankrecs.length);

    console.log(`[PnW Sync] Done — ${nations.length} members, ${wars.length} wars, ${bankrecs.length} bank recs`);
  } catch (error) {
    console.error("[PnW Sync] Failed:", error);
    db.prepare("UPDATE sync_status SET status = 'error', error = ? WHERE id = 1").run(String(error));
    throw error;
  }
}

interface RawNationMembership {
  id: string;
  alliance_id: string;
  alliance_join_date: string | null;
}

interface RawAllianceInfo {
  id: string;
  name: string;
  acronym: string | null;
  score: number | null;
  color: string | null;
  rank: number | null;
}

export async function syncAllianceMemberships(): Promise<void> {
  const now = Date.now();
  console.log("[Recruitment Sync] Starting…");
  db.prepare("UPDATE recruitment_sync_status SET status = 'syncing', error = NULL WHERE id = 1").run();

  try {
    const allNations: RawNationMembership[] = [];
    let page = 1;
    let lastPage = 1;
    do {
      const data = await gql<{
        nations: { paginatorInfo: { currentPage: number; lastPage: number }; data: RawNationMembership[] };
      }>(ALL_MEMBERSHIPS_QUERY, { page });
      allNations.push(...data.nations.data);
      lastPage = data.nations.paginatorInfo.lastPage;
      page += 1;
    } while (page <= lastPage);

    const allAlliances: RawAllianceInfo[] = [];
    let alliancePage = 1;
    let allianceLastPage = 1;
    do {
      const data = await gql<{
        alliances: { paginatorInfo: { currentPage: number; lastPage: number }; data: RawAllianceInfo[] };
      }>(ALL_ALLIANCES_QUERY, { page: alliancePage });
      allAlliances.push(...data.alliances.data);
      allianceLastPage = data.alliances.paginatorInfo.lastPage;
      alliancePage += 1;
    } while (alliancePage <= allianceLastPage);

    const uniqueAlliances = [...new Map(allAlliances.map((alliance) => [Number(alliance.id), alliance])).values()];
    const upsertAlliance = db.prepare(`
      INSERT INTO alliance_names (id, name, acronym, score, color, rank, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, acronym = excluded.acronym, score = excluded.score,
        color = excluded.color, rank = excluded.rank, updated_at = excluded.updated_at
    `);
    db.transaction(() => {
      for (const alliance of uniqueAlliances) {
        upsertAlliance.run(Number(alliance.id), alliance.name, alliance.acronym, alliance.score, alliance.color, alliance.rank, now);
      }
    })();

    const upsertMembership = db.prepare(`
      INSERT INTO alliance_memberships (nation_id, alliance_id, join_date, first_seen, last_seen, left_at)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(nation_id, alliance_id, join_date) DO UPDATE SET last_seen = excluded.last_seen, left_at = NULL
    `);
    const seenKeys = new Set<string>();
    let scanned = 0;
    db.transaction(() => {
      for (const nation of allNations) {
        const allianceId = Number(nation.alliance_id);
        if (!allianceId || !nation.alliance_join_date) continue;
        const joinDate = Date.parse(nation.alliance_join_date);
        if (!Number.isFinite(joinDate)) continue;
        const nationId = Number(nation.id);
        const key = `${nationId}:${allianceId}:${joinDate}`;
        if (seenKeys.has(key)) continue;
        upsertMembership.run(nationId, allianceId, joinDate, now, now);
        seenKeys.add(key);
        scanned += 1;
      }
    })();

    const activeRows = db.prepare(`
      SELECT nation_id, alliance_id, join_date, last_seen
      FROM alliance_memberships WHERE left_at IS NULL
    `).all() as Array<{ nation_id: number; alliance_id: number; join_date: number; last_seen: number }>;
    const closeMembership = db.prepare(`
      UPDATE alliance_memberships SET left_at = ?
      WHERE nation_id = ? AND alliance_id = ? AND join_date = ?
    `);
    db.transaction(() => {
      for (const row of activeRows) {
        if (!seenKeys.has(`${row.nation_id}:${row.alliance_id}:${row.join_date}`)) {
          closeMembership.run(row.last_seen, row.nation_id, row.alliance_id, row.join_date);
        }
      }
    })();

    const existing = db.prepare("SELECT first_snapshot_at FROM recruitment_sync_status WHERE id = 1")
      .get() as { first_snapshot_at: number | null } | undefined;
    const firstSnapshot = existing?.first_snapshot_at ?? now;
    db.prepare(`
      UPDATE recruitment_sync_status
      SET last_synced_at = ?, status = 'success', error = NULL,
          nations_scanned = ?, alliances_scanned = ?, first_snapshot_at = ?
      WHERE id = 1
    `).run(now, scanned, uniqueAlliances.length, firstSnapshot);

    console.log(`[Recruitment Sync] Done — ${scanned} memberships, ${uniqueAlliances.length} alliances`);
  } catch (error) {
    console.error("[Recruitment Sync] Failed:", error);
    db.prepare("UPDATE recruitment_sync_status SET status = 'error', error = ? WHERE id = 1").run(String(error));
    throw error;
  }
}

const globalState = globalThis as typeof globalThis & {
  _pnwSyncStarted?: boolean;
  _recruitmentSyncStarted?: boolean;
  _raidSyncStarted?: boolean;
};
const RECRUITMENT_START_DELAY_MS = 60 * 1000;
const RAID_START_DELAY_MS = 30 * 1000;
const SYNC_REQUEST_POLL_MS = 2 * 1000;
let activeSync: Promise<void> | null = null;
let processingSyncRequest = false;

export function runSync(): Promise<void> {
  if (!activeSync) {
    activeSync = sync().finally(() => {
      activeSync = null;
    });
  }
  return activeSync;
}

async function pollSyncRequest(): Promise<void> {
  if (processingSyncRequest) return;
  processingSyncRequest = true;
  try {
    await processSyncRequest(runSync);
  } catch (error) {
    console.error("[PnW Sync] Queued sync failed:", error);
  } finally {
    processingSyncRequest = false;
  }
}

export function startSyncLoop(): void {
  if (globalState._pnwSyncStarted) return;
  globalState._pnwSyncStarted = true;

  runSync().catch((error) => console.error("[PnW Sync] Initial sync failed:", error));
  setInterval(
    () => runSync().catch((error) => console.error("[PnW Sync] Periodic sync failed:", error)),
    10 * 60 * 1000,
  );

  void pollSyncRequest();
  setInterval(() => void pollSyncRequest(), SYNC_REQUEST_POLL_MS);
  setTimeout(startRecruitmentSyncLoop, RECRUITMENT_START_DELAY_MS);
  setTimeout(startRaidSyncLoop, RAID_START_DELAY_MS);
}

export function startRaidSyncLoop(): void {
  if (globalState._raidSyncStarted) return;
  globalState._raidSyncStarted = true;

  syncRaidIntelligence().catch((error) => console.error("[Raid Sync] Initial run failed:", error));
  setInterval(
    () => syncRaidIntelligence().catch((error) => console.error("[Raid Sync] Periodic failed:", error)),
    60 * 60 * 1000,
  );
}

export function startRecruitmentSyncLoop(): void {
  if (globalState._recruitmentSyncStarted) return;
  globalState._recruitmentSyncStarted = true;

  void (async () => {
    try {
      const row = db.prepare("SELECT last_synced_at FROM recruitment_sync_status WHERE id = 1")
        .get() as { last_synced_at: number | null } | undefined;
      const lastSync = row?.last_synced_at ?? 0;
      if (Date.now() - lastSync >= 23 * 60 * 60 * 1000) await syncAllianceMemberships();
    } catch (error) {
      console.error("[Recruitment Sync] Initial run failed:", error);
    }
  })();

  setInterval(
    () => syncAllianceMemberships().catch((error) => console.error("[Recruitment Sync] Periodic failed:", error)),
    24 * 60 * 60 * 1000,
  );
}
