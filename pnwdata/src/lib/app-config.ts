import db from "./db";

export async function readAppConfig<T>(key: string): Promise<T> {
  const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) throw new Error(`Configuration ${key} is missing`);
  try {
    return JSON.parse(row.value) as T;
  } catch {
    throw new Error(`Configuration ${key} is invalid JSON`);
  }
}

export async function writeAppConfig<T>(key: string, value: T): Promise<void> {
  db.prepare(`
    INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), Date.now());
}
