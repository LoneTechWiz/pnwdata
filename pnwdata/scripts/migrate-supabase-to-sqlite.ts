import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });

const TABLES = [
  "nations",
  "wars",
  "bankrecs",
  "alliance_meta",
  "sync_status",
  "trade_prices",
  "applicants",
  "game_info",
  "stockpile_alert_queue",
  "alliance_memberships",
  "alliance_names",
  "recruitment_sync_status",
  "app_config",
] as const;

type RemoteRow = Record<string, unknown>;

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value) throw new Error(`Missing ${name}${fallback ? ` or ${fallback}` : ""}`);
  return value.replace(/\/$/, "");
}

async function fetchTable(baseUrl: string, key: string, table: string): Promise<RemoteRow[]> {
  const rows: RemoteRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*&limit=1000&offset=${offset}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`${table}: Supabase returned ${response.status}: ${await response.text()}`);
    }
    const batch = await response.json() as RemoteRow[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

function quoted(identifier: string): string {
  if (!/^[a-z_]+$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

async function main() {
  const supabaseUrl = required("SUPABASE_URL");
  const supabaseKey = required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const snapshots = new Map<string, RemoteRow[]>();

  for (const table of TABLES) {
    const rows = await fetchTable(supabaseUrl, supabaseKey, table);
    snapshots.set(table, table === "app_config" ? rows.filter((row) => row.key !== "sync-request") : rows);
    console.log(`[Migration] Downloaded ${rows.length} ${table} row(s)`);
  }

  const databasePath = process.env.PNW_DB_PATH ?? path.join(process.cwd(), "data", "pnw.db");
  if (existsSync(databasePath)) {
    const { default: Database } = await import("better-sqlite3");
    const existingDb = new Database(databasePath);
    existingDb.pragma("wal_checkpoint(TRUNCATE)");
    existingDb.close();
    const backupPath = `${databasePath}.pre-supabase-${Date.now()}.bak`;
    copyFileSync(databasePath, backupPath);
    console.log(`[Migration] Backed up the local database to ${backupPath}`);
  }
  const { default: db } = await import("../src/lib/db");

  db.transaction(() => {
    for (const table of TABLES) {
      const rows = snapshots.get(table) ?? [];
      db.prepare(`DELETE FROM ${quoted(table)}`).run();
      if (rows.length === 0) continue;

      const localColumns = new Set(
        (db.prepare(`PRAGMA table_info(${quoted(table)})`).all() as Array<{ name: string }>).map((column) => column.name),
      );
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
        .filter((column) => localColumns.has(column));
      if (columns.length === 0) continue;
      const placeholders = columns.map(() => "?").join(", ");
      const insert = db.prepare(`
        INSERT INTO ${quoted(table)} (${columns.map(quoted).join(", ")})
        VALUES (${placeholders})
      `);
      for (const row of rows) {
        insert.run(...columns.map((column) => {
          const value = row[column];
          if (value == null) return null;
          if ((column === "data" || column === "value") && typeof value !== "string") return JSON.stringify(value);
          return value;
        }));
      }
    }

    db.prepare("INSERT OR IGNORE INTO sync_status (id, status) VALUES (1, 'never')").run();
    db.prepare("INSERT OR IGNORE INTO recruitment_sync_status (id, status) VALUES (1, 'never')").run();
    const seedConfig = db.prepare(
      "INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES (?, ?, 0)",
    );
    seedConfig.run("role-config", '{"pages":{}}');
    seedConfig.run("war-config", '{"enemy_alliance_ids":[],"ally_alliance_ids":[]}');
    seedConfig.run("stockpile-alert-config", '{"enabled":false,"thresholds":{}}');
  })();

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  console.log("[Migration] Supabase data is now stored in local SQLite.");
}

main().catch((error) => {
  console.error("[Migration] Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
