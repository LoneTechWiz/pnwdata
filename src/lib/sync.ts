import type { Nation, War, BankRec, Alliance } from "./pnw";
import { readFileSync, existsSync } from "fs";
import path from "path";

const STOCKPILE_ALERT_CONFIG_PATH = path.join(process.cwd(), "data", "stockpile-alert-config.json");

interface StockpileAlertConfig {
  enabled: boolean;
  thresholds: Record<string, number | null>;
}

function readStockpileAlertConfig(): StockpileAlertConfig | null {
  if (!existsSync(STOCKPILE_ALERT_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STOCKPILE_ALERT_CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

const ALERT_RESOURCES = ["money", "coal", "oil", "uranium", "iron", "bauxite", "lead", "gasoline", "munitions", "steel", "aluminum", "food"] as const;

const PNW_API = "https://api.politicsandwar.com/graphql";
const BKNET_API = "https://bkpw.net/api/v1";

async function bknetFetch<T>(path: string): Promise<T | null> {
  const token = process.env.BKNET_API_TOKEN;
  if (!token) return null;
  const res = await fetch(`${BKNET_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`BK Net ${path} returned ${res.status}`);
  return res.json();
}

const MY_NATION_QUERY = `{ me { nation { alliance_id } } }`;

const ALLIANCE_QUERY = `
  query($id:[Int]) { alliances(id:$id) { data {
    id name acronym score color rank average_score flag forum_link discord_link
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food
  } } }
`;

const MEMBERS_QUERY = `
  query($alliance_id:[Int]) { nations(alliance_id:$alliance_id, first:500) { data {
    id nation_name leader_name discord score num_cities color last_active continent
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food credits
    soldiers tanks aircraft ships missiles nukes
    vacation_mode_turns beige_turns alliance_position
    war_policy domestic_policy offensive_wars_count defensive_wars_count
    cities { infrastructure land barracks factory hangar drydock hospital policestation recycling_center subway }
    mass_irrigation international_trade_center telecommunications_satellite uranium_enrichment_program
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
  { game_info { radiation { global north_america south_america europe africa asia australia } } }
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
  const res = await fetch(`${PNW_API}?api_key=${process.env.PNW_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export async function sync(): Promise<void> {
  const { default: db } = await import("./db");

  console.log("[PnW Sync] Starting sync…");
  db.prepare(`UPDATE sync_status SET status = 'syncing' WHERE id = 1`).run();

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
      gql<{ game_info: { radiation: Record<string, number> } }>(GAME_INFO_QUERY),
    ]);

    const bknetData = await bknetFetch<{ members: unknown[] }>("/members").catch(err => {
      console.warn("[PnW Sync] BK Net unavailable, skipping:", err instanceof Error ? err.message : err);
      return null;
    });

    const now = Date.now();
    const applicants = membersData.nations.data.filter(n => n.alliance_position === "APPLICANT");
    const nations = membersData.nations.data.filter(n => n.alliance_position !== "APPLICANT");
    const wars = warsData.wars.data;
    const bankrecs = bankData.bankrecs.data;
    const alliance = allianceData.alliances.data[0];

    if (alliance) {
      // member_count is not a direct field; derive it from the fetched nations
      const allianceWithCount = { ...alliance, member_count: nations.length };
      db.prepare(`INSERT OR REPLACE INTO alliance_meta (id, data, updated_at) VALUES (1, ?, ?)`)
        .run(JSON.stringify(allianceWithCount), now);
    }

    const latestPrice = tradePricesData.tradeprices.data[0];
    if (latestPrice) {
      db.prepare(`INSERT OR REPLACE INTO trade_prices (id, data, updated_at) VALUES (1, ?, ?)`)
        .run(JSON.stringify(latestPrice), now);
    }

    db.prepare(`INSERT OR REPLACE INTO game_info (id, data, updated_at) VALUES (1, ?, ?)`)
      .run(JSON.stringify(gameInfoData.game_info), now);

    const upsertNation = db.prepare(`INSERT OR REPLACE INTO nations (id, data, updated_at) VALUES (?, ?, ?)`);
    db.transaction((items: Nation[]) => {
      for (const n of items) upsertNation.run(n.id, JSON.stringify(n), now);
    })(nations);
    if (nations.length > 0) {
      db.prepare(`DELETE FROM nations WHERE id NOT IN (${nations.map(n => n.id).join(",")})`).run();
    }

    const upsertApplicant = db.prepare(`INSERT OR REPLACE INTO applicants (id, data, updated_at) VALUES (?, ?, ?)`);
    db.transaction((items: Nation[]) => {
      for (const n of items) upsertApplicant.run(n.id, JSON.stringify(n), now);
    })(applicants);
    if (applicants.length > 0) {
      db.prepare(`DELETE FROM applicants WHERE id NOT IN (${applicants.map(n => n.id).join(",")})`).run();
    } else {
      db.prepare(`DELETE FROM applicants`).run();
    }

    db.prepare(`DELETE FROM wars`).run();
    const insertWar = db.prepare(`INSERT INTO wars (id, data, updated_at) VALUES (?, ?, ?)`);
    db.transaction((items: War[]) => {
      for (const w of items) insertWar.run(w.id, JSON.stringify(w), now);
    })(wars);

    const upsertBankrec = db.prepare(`INSERT OR REPLACE INTO bankrecs (id, data, updated_at) VALUES (?, ?, ?)`);
    db.transaction((items: BankRec[]) => {
      for (const b of items) upsertBankrec.run(b.id, JSON.stringify(b), now);
    })(bankrecs);

    if (bknetData?.members) {
      const upsertBknet = db.prepare(`INSERT OR REPLACE INTO bknet_members (id, data, updated_at) VALUES (?, ?, ?)`);
      const bknetMembers = bknetData.members as Array<{ nation: { id: number } }>;
      db.transaction((items: typeof bknetMembers) => {
        for (const m of items) upsertBknet.run(m.nation.id, JSON.stringify(m), now);
      })(bknetMembers);
      if (bknetMembers.length > 0) {
        db.prepare(`DELETE FROM bknet_members WHERE id NOT IN (${bknetMembers.map(m => m.nation.id).join(",")})`).run();
      }
      console.log(`[PnW Sync] BK Net — ${bknetMembers.length} members synced`);
    }

    // ── Stockpile alerts ──────────────────────────────────────────────────────
    const alertConfig = readStockpileAlertConfig();
    if (alertConfig?.enabled) {
      // Clean up sent alerts older than 7 days
      db.prepare(`DELETE FROM stockpile_alert_queue WHERE sent = 1 AND sent_at < ?`)
        .run(now - 7 * 24 * 60 * 60 * 1000);

      // Build discord username map. BK Net is primary but may lag behind Discord's
      // new username system (still returning legacy "User#1234" format). If BK Net
      // has a legacy discriminator and PnW has a current username, prefer PnW.
      // Strip trailing #0 (new-format placeholder discriminator) from either source.
      function normalizeDiscord(raw: string): string {
        return raw.replace(/#0$/, "");
      }
      function isLegacyDiscord(raw: string): boolean {
        const m = raw.match(/#(\d+)$/);
        return m != null && m[1] !== "0" && m[1] !== "0000";
      }

      const bknetRows = db.prepare(`SELECT id, data FROM bknet_members`).all() as Array<{ id: number; data: string }>;
      const bknetDiscordRaw = new Map<string, string>();
      const bknetDiscordIdMap = new Map<string, string>();
      for (const row of bknetRows) {
        const m = JSON.parse(row.data) as { discord?: { account?: { discord_username?: string; discord_id?: string } } };
        const raw = m.discord?.account?.discord_username;
        const id = m.discord?.account?.discord_id;
        if (raw) bknetDiscordRaw.set(String(row.id), raw);
        if (id) bknetDiscordIdMap.set(String(row.id), id);
      }

      const discordMap = new Map<string, string>();
      for (const nation of nations) {
        const bknet = bknetDiscordRaw.get(String(nation.id));
        const pnw = nation.discord?.trim() || null;
        if (bknet && !isLegacyDiscord(bknet)) {
          discordMap.set(String(nation.id), normalizeDiscord(bknet));
        } else if (pnw) {
          discordMap.set(String(nation.id), normalizeDiscord(pnw));
        } else if (bknet) {
          discordMap.set(String(nation.id), bknet);
        }
      }

      // Build set of blockaded nation IDs from active wars
      const warRows = db.prepare(`SELECT data FROM wars`).all() as Array<{ data: string }>;
      const blockadedIds = new Set<number>();
      for (const row of warRows) {
        const w = JSON.parse(row.data) as { naval_blockade: number; att_id: number; def_id: number };
        if (!w.naval_blockade) continue;
        if (w.naval_blockade === w.att_id) blockadedIds.add(w.def_id);
        else if (w.naval_blockade === w.def_id) blockadedIds.add(w.att_id);
      }

      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const insertAlert = db.prepare(
        `INSERT INTO stockpile_alert_queue (nation_id, nation_name, discord_username, discord_id, resource, amount, num_cities, threshold, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const nation of nations) {
        if (nation.vacation_mode_turns > 0) continue;

        // 24h cooldown per nation (not per resource)
        const recentAny = db.prepare(
          `SELECT id FROM stockpile_alert_queue WHERE nation_id = ? AND created_at > ? LIMIT 1`
        ).get(nation.id, oneDayAgo);
        if (recentAny) continue;

        const discord = discordMap.get(String(nation.id)) ?? null;
        const isBlockaded = blockadedIds.has(nation.id);

        for (const resource of ALERT_RESOURCES) {
          // Blockaded nations: only alert for cash
          if (isBlockaded && resource !== "money") continue;

          const threshold = alertConfig.thresholds[resource];
          if (threshold == null || threshold <= 0) continue;
          const amount = (nation[resource as keyof Nation] as number) ?? 0;
          // Uranium uses a flat threshold; all other resources are per-city.
          const limit = resource === "uranium" ? threshold : threshold * nation.num_cities;
          if (amount <= limit) continue;

          const discordId = bknetDiscordIdMap.get(String(nation.id)) ?? null;
          insertAlert.run(nation.id, nation.nation_name, discord, discordId, resource, amount, nation.num_cities, threshold, now);
        }
      }
    }

    db.prepare(
      `UPDATE sync_status SET last_synced_at=?, status='success', error=NULL, member_count=?, war_count=?, bankrec_count=? WHERE id=1`
    ).run(now, nations.length, wars.length, bankrecs.length);

    console.log(`[PnW Sync] Done — ${nations.length} members, ${wars.length} wars, ${bankrecs.length} bank recs`);
  } catch (err) {
    console.error("[PnW Sync] Failed:", err);
    db.prepare(`UPDATE sync_status SET status='error', error=? WHERE id=1`).run(String(err));
    throw err;
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
  const { default: db } = await import("./db");
  const now = Date.now();

  console.log("[Recruitment Sync] Starting…");
  db.prepare(`UPDATE recruitment_sync_status SET status='syncing' WHERE id=1`).run();

  try {
    const allNations: RawNationMembership[] = [];
    let page = 1;
    let lastPage = 1;
    do {
      const data = await gql<{
        nations: {
          paginatorInfo: { currentPage: number; lastPage: number };
          data: RawNationMembership[];
        };
      }>(ALL_MEMBERSHIPS_QUERY, { page });
      allNations.push(...data.nations.data);
      lastPage = data.nations.paginatorInfo.lastPage;
      page++;
    } while (page <= lastPage);

    const allAlliances: RawAllianceInfo[] = [];
    let aPage = 1;
    let aLast = 1;
    do {
      const data = await gql<{
        alliances: {
          paginatorInfo: { currentPage: number; lastPage: number };
          data: RawAllianceInfo[];
        };
      }>(ALL_ALLIANCES_QUERY, { page: aPage });
      allAlliances.push(...data.alliances.data);
      aLast = data.alliances.paginatorInfo.lastPage;
      aPage++;
    } while (aPage <= aLast);

    const upsertAlliance = db.prepare(
      `INSERT INTO alliance_names (id, name, acronym, score, color, rank, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, acronym=excluded.acronym, score=excluded.score, color=excluded.color, rank=excluded.rank, updated_at=excluded.updated_at`
    );
    db.transaction((items: RawAllianceInfo[]) => {
      for (const a of items) {
        upsertAlliance.run(Number(a.id), a.name, a.acronym ?? null, a.score ?? null, a.color ?? null, a.rank ?? null, now);
      }
    })(allAlliances);

    const upsertMembership = db.prepare(
      `INSERT INTO alliance_memberships (nation_id, alliance_id, join_date, first_seen, last_seen, left_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(nation_id, alliance_id, join_date) DO UPDATE SET last_seen=excluded.last_seen, left_at=NULL`
    );

    const seenKeys = new Set<string>();
    let scanned = 0;
    db.transaction((items: RawNationMembership[]) => {
      for (const n of items) {
        const allianceId = Number(n.alliance_id);
        if (!allianceId || !n.alliance_join_date) continue;
        const joinMs = Date.parse(n.alliance_join_date);
        if (!Number.isFinite(joinMs)) continue;
        const nationId = Number(n.id);
        upsertMembership.run(nationId, allianceId, joinMs, now, now);
        seenKeys.add(`${nationId}:${allianceId}:${joinMs}`);
        scanned++;
      }
    })(allNations);

    // Close memberships not seen this run.
    const activeRows = db.prepare(
      `SELECT nation_id, alliance_id, join_date, last_seen FROM alliance_memberships WHERE left_at IS NULL`
    ).all() as Array<{ nation_id: number; alliance_id: number; join_date: number; last_seen: number }>;

    const closeMembership = db.prepare(
      `UPDATE alliance_memberships SET left_at=? WHERE nation_id=? AND alliance_id=? AND join_date=?`
    );
    db.transaction((rows: typeof activeRows) => {
      for (const r of rows) {
        const key = `${r.nation_id}:${r.alliance_id}:${r.join_date}`;
        if (!seenKeys.has(key)) {
          // Use the previous last_seen as a more accurate left timestamp than `now`.
          closeMembership.run(r.last_seen, r.nation_id, r.alliance_id, r.join_date);
        }
      }
    })(activeRows);

    const existing = db.prepare(`SELECT first_snapshot_at FROM recruitment_sync_status WHERE id=1`).get() as { first_snapshot_at: number | null } | undefined;
    const firstSnapshot = existing?.first_snapshot_at ?? now;
    db.prepare(
      `UPDATE recruitment_sync_status SET last_synced_at=?, status='success', error=NULL,
       nations_scanned=?, alliances_scanned=?, first_snapshot_at=? WHERE id=1`
    ).run(now, scanned, allAlliances.length, firstSnapshot);

    console.log(`[Recruitment Sync] Done — ${scanned} memberships, ${allAlliances.length} alliances`);
  } catch (err) {
    console.error("[Recruitment Sync] Failed:", err);
    db.prepare(`UPDATE recruitment_sync_status SET status='error', error=? WHERE id=1`).run(String(err));
    throw err;
  }
}

const g = globalThis as typeof globalThis & { _pnwSyncStarted?: boolean; _recruitmentSyncStarted?: boolean };

export function startSyncLoop(): void {
  if (g._pnwSyncStarted) return;
  g._pnwSyncStarted = true;

  sync().catch(err => console.error("[PnW Sync] Initial sync failed:", err));
  setInterval(
    () => sync().catch(err => console.error("[PnW Sync] Periodic sync failed:", err)),
    10 * 60 * 1000
  );

  startRecruitmentSyncLoop();
}

export function startRecruitmentSyncLoop(): void {
  if (g._recruitmentSyncStarted) return;
  g._recruitmentSyncStarted = true;

  // Run once on boot if last sync was > 23h ago (or never), then every 24h.
  (async () => {
    try {
      const { default: db } = await import("./db");
      const row = db.prepare(`SELECT last_synced_at FROM recruitment_sync_status WHERE id=1`).get() as { last_synced_at: number | null } | undefined;
      const last = row?.last_synced_at ?? 0;
      const age = Date.now() - last;
      if (age >= 23 * 60 * 60 * 1000) {
        await syncAllianceMemberships();
      }
    } catch (err) {
      console.error("[Recruitment Sync] Initial run failed:", err);
    }
  })();

  setInterval(
    () => syncAllianceMemberships().catch(err => console.error("[Recruitment Sync] Periodic failed:", err)),
    24 * 60 * 60 * 1000
  );
}
