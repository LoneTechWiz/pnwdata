import type { Nation, War, BankRec, Alliance } from "./pnw";
import { resolveNationDiscord } from "./discord-username";
import { exceedsStockpileThreshold } from "./stockpile";
import { selectAll, supabase } from "./supabase";
import { readAppConfig } from "./app-config";

function fail(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function replaceSnapshot(table: string, rows: Array<Record<string, unknown>>) {
  const { error: deleteError } = await supabase.from(table).delete().not("id", "is", null);
  fail(deleteError, `${table} delete`);
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(offset, offset + 500));
    fail(error, `${table} insert`);
  }
}

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
    id nation_name leader_name discord score num_cities population color last_active continent
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food credits
    soldiers tanks aircraft ships missiles nukes
    vacation_mode_turns beige_turns alliance_position
    war_policy domestic_policy offensive_wars_count defensive_wars_count
    cities { date powered infrastructure land barracks factory hangar drydock hospital policestation recycling_center subway }
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
  console.log("[PnW Sync] Starting sync…");
  fail((await supabase.from("sync_status").update({ status: "syncing" }).eq("id", 1)).error, "sync status");

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
      fail((await supabase.from("alliance_meta").upsert({ id: 1, data: allianceWithCount, updated_at: now })).error, "alliance meta");
    }

    const latestPrice = tradePricesData.tradeprices.data[0];
    if (latestPrice) {
      fail((await supabase.from("trade_prices").upsert({ id: 1, data: latestPrice, updated_at: now })).error, "trade prices");
    }

    fail((await supabase.from("game_info").upsert({ id: 1, data: gameInfoData.game_info, updated_at: now })).error, "game info");
    await replaceSnapshot("nations", nations.map(n => ({ id: n.id, data: n, updated_at: now })));
    await replaceSnapshot("applicants", applicants.map(n => ({ id: n.id, data: n, updated_at: now })));
    await replaceSnapshot("wars", wars.map(w => ({ id: w.id, data: w, updated_at: now })));
    if (bankrecs.length) fail((await supabase.from("bankrecs").upsert(bankrecs.map(b => ({ id: b.id, data: b, updated_at: now })))).error, "bank records");

    if (bknetData?.members) {
      const bknetMembers = bknetData.members as Array<{ nation: { id: number } }>;
      await replaceSnapshot("bknet_members", bknetMembers.map(m => ({ id: m.nation.id, data: m, updated_at: now })));
      console.log(`[PnW Sync] BK Net — ${bknetMembers.length} members synced`);
    }

    // ── Stockpile alerts ──────────────────────────────────────────────────────
    const alertConfig = await readStockpileAlertConfig();
    if (alertConfig?.enabled) {
      // Clean up sent alerts older than 7 days
      fail((await supabase.from("stockpile_alert_queue").delete().eq("sent", 1).lt("sent_at", now - 7 * 86400000)).error, "alert cleanup");
      const { data: bknetRows, error: bknetError } = await supabase.from("bknet_members").select("id, data");
      fail(bknetError, "BK Net alert lookup");
      const bknetDiscordRaw = new Map<string, string>();
      const bknetDiscordIdMap = new Map<string, string>();
      for (const row of bknetRows ?? []) {
        const m = row.data as { discord?: { account?: { discord_username?: string; discord_id?: string } } };
        const raw = m.discord?.account?.discord_username;
        const id = m.discord?.account?.discord_id;
        if (raw) bknetDiscordRaw.set(String(row.id), raw);
        if (id) bknetDiscordIdMap.set(String(row.id), id);
      }

      const discordMap = new Map<string, string>();
      for (const nation of nations) {
        const resolved = resolveNationDiscord(
          bknetDiscordRaw.get(String(nation.id)),
          nation.discord
        );
        if (resolved) discordMap.set(String(nation.id), resolved);
      }

      // Build set of blockaded nation IDs from active wars
      const blockadedIds = new Set<number>();
      for (const w of wars as Array<War & { naval_blockade: number; att_id: number; def_id: number }>) {
        if (!w.naval_blockade) continue;
        if (w.naval_blockade === w.att_id) blockadedIds.add(w.def_id);
        else if (w.naval_blockade === w.def_id) blockadedIds.add(w.att_id);
      }

      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const pendingAlerts: Array<Record<string, unknown>> = [];

      for (const nation of nations) {
        if (nation.vacation_mode_turns > 0) continue;

        // 24h cooldown per nation (not per resource)
        const { data: recentAny, error: recentError } = await supabase.from("stockpile_alert_queue").select("id").eq("nation_id", nation.id).gt("created_at", oneDayAgo).limit(1).maybeSingle();
        fail(recentError, "alert cooldown");
        if (recentAny) continue;

        const discord = discordMap.get(String(nation.id)) ?? null;
        const isBlockaded = blockadedIds.has(nation.id);

        for (const resource of ALERT_RESOURCES) {
          // Blockaded nations: only alert for cash
          if (isBlockaded && resource !== "money") continue;

          const threshold = alertConfig.thresholds[resource];
          if (threshold == null) continue;
          const amount = (nation[resource as keyof Nation] as number) ?? 0;
          if (!exceedsStockpileThreshold(amount, threshold, resource, nation.num_cities)) continue;

          const discordId = bknetDiscordIdMap.get(String(nation.id)) ?? null;
          pendingAlerts.push({ nation_id: nation.id, nation_name: nation.nation_name, discord_username: discord, discord_id: discordId, resource, amount, num_cities: nation.num_cities, threshold, created_at: now });
        }
      }
      if (pendingAlerts.length) fail((await supabase.from("stockpile_alert_queue").insert(pendingAlerts)).error, "alert insert");
    }

    fail((await supabase.from("sync_status").update({ last_synced_at: now, status: "success", error: null, member_count: nations.length, war_count: wars.length, bankrec_count: bankrecs.length }).eq("id", 1)).error, "sync status success");

    console.log(`[PnW Sync] Done — ${nations.length} members, ${wars.length} wars, ${bankrecs.length} bank recs`);
  } catch (err) {
    console.error("[PnW Sync] Failed:", err);
    await supabase.from("sync_status").update({ status: "error", error: String(err) }).eq("id", 1);
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
  const now = Date.now();

  console.log("[Recruitment Sync] Starting…");
  fail((await supabase.from("recruitment_sync_status").update({ status: "syncing" }).eq("id", 1)).error, "recruitment status");

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

    // Rankings can shift while the paginated crawl is running, causing an
    // alliance to appear on more than one page. Supabase cannot upsert the
    // same conflict key twice in a single statement.
    const uniqueAlliances = [...new Map(allAlliances.map(a => [Number(a.id), a])).values()];
    for (let offset = 0; offset < uniqueAlliances.length; offset += 500) {
      const rows = uniqueAlliances.slice(offset, offset + 500).map(a => ({ id: Number(a.id), name: a.name, acronym: a.acronym, score: a.score, color: a.color, rank: a.rank, updated_at: now }));
      fail((await supabase.from("alliance_names").upsert(rows)).error, "alliance names");
    }

    const seenKeys = new Set<string>();
    let scanned = 0;
    const existingMemberships = await selectAll<{ nation_id: number; alliance_id: number; join_date: number; first_seen: number }>("alliance_memberships", "nation_id, alliance_id, join_date, first_seen");
    const firstSeenByKey = new Map(existingMemberships.map(row => [`${row.nation_id}:${row.alliance_id}:${row.join_date}`, row.first_seen]));
    const membershipRows: Array<Record<string, unknown>> = [];
    for (const n of allNations) {
      const allianceId = Number(n.alliance_id);
      if (!allianceId || !n.alliance_join_date) continue;
      const joinMs = Date.parse(n.alliance_join_date);
      if (!Number.isFinite(joinMs)) continue;
      const nationId = Number(n.id);
      const key = `${nationId}:${allianceId}:${joinMs}`;
      if (seenKeys.has(key)) continue;
      membershipRows.push({ nation_id: nationId, alliance_id: allianceId, join_date: joinMs, first_seen: firstSeenByKey.get(key) ?? now, last_seen: now, left_at: null });
      seenKeys.add(key);
      scanned++;
    }
    for (let offset = 0; offset < membershipRows.length; offset += 500) {
      fail((await supabase.from("alliance_memberships").upsert(membershipRows.slice(offset, offset + 500), { onConflict: "nation_id,alliance_id,join_date" })).error, "memberships");
    }

    // Close memberships not seen this run.
    const activeRows = (await selectAll<{ nation_id: number; alliance_id: number; join_date: number; last_seen: number; left_at: number | null }>("alliance_memberships", "nation_id, alliance_id, join_date, last_seen, left_at")).filter(row => row.left_at == null);
    for (const r of activeRows) {
      if (!seenKeys.has(`${r.nation_id}:${r.alliance_id}:${r.join_date}`)) {
        fail((await supabase.from("alliance_memberships").update({ left_at: r.last_seen }).eq("nation_id", r.nation_id).eq("alliance_id", r.alliance_id).eq("join_date", r.join_date)).error, "close membership");
      }
    }

    const { data: existing, error: statusError } = await supabase.from("recruitment_sync_status").select("first_snapshot_at").eq("id", 1).maybeSingle();
    fail(statusError, "recruitment status read");
    const firstSnapshot = existing?.first_snapshot_at ?? now;
    fail((await supabase.from("recruitment_sync_status").update({ last_synced_at: now, status: "success", error: null, nations_scanned: scanned, alliances_scanned: uniqueAlliances.length, first_snapshot_at: firstSnapshot }).eq("id", 1)).error, "recruitment status success");

    console.log(`[Recruitment Sync] Done — ${scanned} memberships, ${uniqueAlliances.length} alliances`);
  } catch (err) {
    console.error("[Recruitment Sync] Failed:", err);
    await supabase.from("recruitment_sync_status").update({ status: "error", error: String(err) }).eq("id", 1);
    throw err;
  }
}

const g = globalThis as typeof globalThis & { _pnwSyncStarted?: boolean; _recruitmentSyncStarted?: boolean };
const RECRUITMENT_START_DELAY_MS = 60 * 1000;

export function startSyncLoop(): void {
  if (g._pnwSyncStarted) return;
  g._pnwSyncStarted = true;

  sync().catch(err => console.error("[PnW Sync] Initial sync failed:", err));
  setInterval(
    () => sync().catch(err => console.error("[PnW Sync] Periodic sync failed:", err)),
    10 * 60 * 1000
  );

  // The recruitment crawl is API-heavy. Keep it out of the same rate-limit
  // window as the main sync that runs immediately when the worker starts.
  setTimeout(startRecruitmentSyncLoop, RECRUITMENT_START_DELAY_MS);
}

export function startRecruitmentSyncLoop(): void {
  if (g._recruitmentSyncStarted) return;
  g._recruitmentSyncStarted = true;

  // Run once on boot if last sync was > 23h ago (or never), then every 24h.
  (async () => {
    try {
      const { data: row, error } = await supabase.from("recruitment_sync_status").select("last_synced_at").eq("id", 1).maybeSingle();
      fail(error, "recruitment schedule status");
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
