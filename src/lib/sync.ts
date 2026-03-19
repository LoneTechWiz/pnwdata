import type { Nation, War, BankRec, Alliance } from "./pnw";

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
    money gasoline munitions steel aluminum
    soldiers tanks aircraft ships missiles nukes
    vacation_mode_turns beige_turns alliance_position
    war_policy domestic_policy offensive_wars_count defensive_wars_count
    cities { infrastructure land barracks factory hangar drydock hospital policestation recycling_center subway }
    mass_irrigation international_trade_center telecommunications_satellite uranium_enrichment_program
  } } }
`;

const WARS_QUERY = `
  query($alliance_id:[Int]) { wars(alliance_id:$alliance_id, active:true) { data {
    id date reason war_type turns_left
    att_id att_alliance_id
    def_id def_alliance_id
    attacker { nation_name leader_name alliance { name } }
    defender { nation_name leader_name alliance { name } }
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

const g = globalThis as typeof globalThis & { _pnwSyncStarted?: boolean };

export function startSyncLoop(): void {
  if (g._pnwSyncStarted) return;
  g._pnwSyncStarted = true;

  sync().catch(err => console.error("[PnW Sync] Initial sync failed:", err));
  setInterval(
    () => sync().catch(err => console.error("[PnW Sync] Periodic sync failed:", err)),
    10 * 60 * 1000
  );
}
