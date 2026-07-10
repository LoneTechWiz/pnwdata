import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.PNW_DB_PATH ?? path.join(DATA_DIR, "pnw.db"));

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

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

  CREATE TABLE IF NOT EXISTS bknet_members (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
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

  INSERT OR IGNORE INTO sync_status (id, status) VALUES (1, 'never');

  CREATE TABLE IF NOT EXISTS quiz_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT UNIQUE NOT NULL,
    squire_discord_id TEXT NOT NULL,
    squire_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    current_question INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS discord_resolved (
    discord_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
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
  INSERT OR IGNORE INTO recruitment_sync_status (id, status) VALUES (1, 'never');
`);

export default db;
