import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databasePath = process.env.PNW_DB_PATH ?? path.join(process.cwd(), "data", "pnw.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS nations (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wars (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bankrecs (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS raid_nations (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS raid_income_snapshots (
    nation_id INTEGER NOT NULL,
    snapshot_day TEXT NOT NULL,
    gross_national_income REAL NOT NULL,
    captured_at INTEGER NOT NULL,
    PRIMARY KEY (nation_id, snapshot_day)
  );
  CREATE INDEX IF NOT EXISTS idx_raid_income_nation_time
    ON raid_income_snapshots(nation_id, captured_at);

  CREATE TABLE IF NOT EXISTS raid_beige_events (
    war_id INTEGER NOT NULL,
    nation_id INTEGER NOT NULL,
    beige_date INTEGER NOT NULL,
    loot_value REAL NOT NULL,
    nation_loot_value REAL,
    alliance_loot_value REAL,
    recorded_at INTEGER NOT NULL,
    PRIMARY KEY (war_id, nation_id)
  );
  CREATE INDEX IF NOT EXISTS idx_raid_beige_nation_date
    ON raid_beige_events(nation_id, beige_date);

  CREATE TABLE IF NOT EXISTS raid_sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_at INTEGER,
    status TEXT NOT NULL DEFAULT 'never',
    error TEXT,
    candidate_count INTEGER DEFAULT 0,
    beige_event_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS alliance_meta (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_at INTEGER,
    status TEXT NOT NULL DEFAULT 'never',
    error TEXT,
    member_count INTEGER DEFAULT 0,
    war_count INTEGER DEFAULT 0,
    bankrec_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trade_prices (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stockpile_alert_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nation_id INTEGER NOT NULL,
    nation_name TEXT NOT NULL,
    discord_username TEXT,
    discord_id TEXT,
    resource TEXT NOT NULL,
    amount REAL NOT NULL,
    num_cities INTEGER NOT NULL,
    threshold REAL NOT NULL,
    created_at INTEGER NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS discord_nation_links (
    nation_id INTEGER PRIMARY KEY,
    discord_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alliance_memberships (
    nation_id INTEGER NOT NULL,
    alliance_id INTEGER NOT NULL,
    join_date INTEGER NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    left_at INTEGER,
    PRIMARY KEY (nation_id, alliance_id, join_date)
  );
  CREATE INDEX IF NOT EXISTS idx_memberships_alliance ON alliance_memberships(alliance_id);
  CREATE INDEX IF NOT EXISTS idx_memberships_join_date ON alliance_memberships(join_date);
  CREATE INDEX IF NOT EXISTS idx_memberships_left_at ON alliance_memberships(left_at);

  CREATE TABLE IF NOT EXISTS alliance_names (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    acronym TEXT,
    score REAL,
    color TEXT,
    rank INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recruitment_sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_at INTEGER,
    status TEXT NOT NULL DEFAULT 'never',
    error TEXT,
    nations_scanned INTEGER DEFAULT 0,
    alliances_scanned INTEGER DEFAULT 0,
    first_snapshot_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS offshore_alliances (
    alliance_id INTEGER PRIMARY KEY,
    alliance_name TEXT NOT NULL,
    label TEXT,
    api_key TEXT NOT NULL,
    added_by_discord_id TEXT NOT NULL,
    added_by_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    member_count INTEGER NOT NULL DEFAULT 0,
    war_count INTEGER NOT NULL DEFAULT 0,
    bankrec_count INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS offshore_nations (
    alliance_id INTEGER NOT NULL REFERENCES offshore_alliances(alliance_id) ON DELETE CASCADE,
    id INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (alliance_id, id)
  );

  CREATE TABLE IF NOT EXISTS offshore_wars (
    alliance_id INTEGER NOT NULL REFERENCES offshore_alliances(alliance_id) ON DELETE CASCADE,
    id INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (alliance_id, id)
  );

  CREATE TABLE IF NOT EXISTS offshore_bankrecs (
    alliance_id INTEGER NOT NULL REFERENCES offshore_alliances(alliance_id) ON DELETE CASCADE,
    id INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (alliance_id, id)
  );

  CREATE TABLE IF NOT EXISTS offshore_alliance_meta (
    alliance_id INTEGER PRIMARY KEY REFERENCES offshore_alliances(alliance_id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tax_bracket_config (
    alliance_id INTEGER NOT NULL,
    bracket_id INTEGER NOT NULL,
    bracket_name TEXT NOT NULL,
    nominal_money_rate INTEGER NOT NULL,
    nominal_resource_rate INTEGER NOT NULL,
    real_money_rate INTEGER NOT NULL,
    real_resource_rate INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (alliance_id, bracket_id)
  );

  CREATE TABLE IF NOT EXISTS tax_records (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS offshore_tax_records (
    alliance_id INTEGER NOT NULL REFERENCES offshore_alliances(alliance_id) ON DELETE CASCADE,
    id INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (alliance_id, id)
  );

  INSERT OR IGNORE INTO sync_status (id, status) VALUES (1, 'never');
  INSERT OR IGNORE INTO recruitment_sync_status (id, status) VALUES (1, 'never');
  INSERT OR IGNORE INTO raid_sync_status (id, status) VALUES (1, 'never');
  INSERT OR IGNORE INTO app_config (key, value, updated_at)
    VALUES ('role-config', '{"pages":{}}', 0);
  INSERT OR IGNORE INTO app_config (key, value, updated_at)
    VALUES ('war-config', '{"enemy_alliance_ids":[],"ally_alliance_ids":[]}', 0);
  INSERT OR IGNORE INTO app_config (key, value, updated_at)
    VALUES ('stockpile-alert-config', '{"enabled":false,"thresholds":{}}', 0);
  INSERT OR IGNORE INTO app_config (key, value, updated_at)
    VALUES ('raid-finder-config', '{"min_inactive_days":7}', 0);
`);

const raidBeigeColumns = new Set(
  (db.prepare("PRAGMA table_info(raid_beige_events)").all() as Array<{ name: string }>)
    .map((column) => column.name),
);
if (!raidBeigeColumns.has("nation_loot_value")) {
  db.exec("ALTER TABLE raid_beige_events ADD COLUMN nation_loot_value REAL");
}
if (!raidBeigeColumns.has("alliance_loot_value")) {
  db.exec("ALTER TABLE raid_beige_events ADD COLUMN alliance_loot_value REAL");
}

// Remove data stores that belonged to the retired external integration.
db.exec(`
  DROP TABLE IF EXISTS bknet_members;
  DROP TABLE IF EXISTS discord_resolved;
`);

// Carry existing page grants forward while removing routes retired by Raid Finder.
const storedRoleConfig = db.prepare("SELECT value FROM app_config WHERE key = 'role-config'")
  .get() as { value: string } | undefined;
if (storedRoleConfig) {
  try {
    const config = JSON.parse(storedRoleConfig.value) as { pages?: Record<string, string[]> };
    const pages = config.pages ?? {};
    pages["/raid-finder"] ??= pages["/ai-targets"] ?? pages["/beige-watch"] ?? [];
    pages["/raid-config"] ??= pages["/role-config"] ?? [];
    pages["/stagnant-cities-config"] ??= pages["/role-config"] ?? [];
    for (const retiredPath of ["/ai-targets", "/optimizer", "/infra", "/bank"]) {
      delete pages[retiredPath];
    }
    db.prepare("UPDATE app_config SET value = ?, updated_at = ? WHERE key = 'role-config'")
      .run(JSON.stringify({ pages }), Date.now());
  } catch {
    // Leave malformed configuration untouched so the existing admin UI can repair it.
  }
}

type JsonRow = { id: number; data: string };

export function readJsonRows<T>(table: "nations" | "wars" | "bankrecs" | "applicants"): T[] {
  const rows = db.prepare(`SELECT data FROM ${table}`).all() as Array<Pick<JsonRow, "data">>;
  return rows.map((row) => JSON.parse(row.data) as T);
}

export function readJsonSingleton<T>(table: "alliance_meta" | "trade_prices" | "game_info"): T | null {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = 1`).get() as Pick<JsonRow, "data"> | undefined;
  return row ? JSON.parse(row.data) as T : null;
}

type NationData = { discord?: string | null };

export function findNationByDiscordId(discordId: string): { id: number; data: NationData } | null {
  const link = db.prepare("SELECT nation_id FROM discord_nation_links WHERE discord_id = ?")
    .get(discordId) as { nation_id: number } | undefined;
  return link ? getNationRecord(link.nation_id) : null;
}

export function getNationRecord(id: number): { id: number; data: NationData } | null {
  const row = db.prepare(`
    SELECT id, data FROM nations WHERE id = ?
    UNION ALL
    SELECT id, data FROM applicants WHERE id = ?
    LIMIT 1
  `).get(id, id) as JsonRow | undefined;
  return row ? { id: row.id, data: JSON.parse(row.data) as NationData } : null;
}

export default db;
