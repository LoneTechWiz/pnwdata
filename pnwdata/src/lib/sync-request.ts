import db from "./db";

const SYNC_REQUEST_KEY = "sync-request";

export interface SyncRequest {
  id: string;
  status: "pending" | "running" | "success" | "error";
  requestedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export async function readSyncRequest(): Promise<SyncRequest | null> {
  const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(SYNC_REQUEST_KEY) as { value: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as SyncRequest;
}

async function writeSyncRequest(request: SyncRequest): Promise<void> {
  db.prepare(`
    INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(SYNC_REQUEST_KEY, JSON.stringify(request), Date.now());
}

export async function enqueueSyncRequest(): Promise<{ request: SyncRequest; created: boolean }> {
  return db.transaction(() => {
    const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(SYNC_REQUEST_KEY) as { value: string } | undefined;
    const existing = row ? JSON.parse(row.value) as SyncRequest : null;
    if (existing?.status === "pending" || existing?.status === "running") {
      return { request: existing, created: false };
    }

    const now = Date.now();
    const request: SyncRequest = {
      id: crypto.randomUUID(),
      status: "pending",
      requestedAt: now,
    };
    db.prepare(`
      INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(SYNC_REQUEST_KEY, JSON.stringify(request), now);
    db.prepare("UPDATE sync_status SET status = 'syncing', error = NULL WHERE id = 1").run();
    return { request, created: true };
  })();
}

export async function processSyncRequest(runSync: () => Promise<void>): Promise<boolean> {
  const request = await readSyncRequest();
  if (!request || (request.status !== "pending" && request.status !== "running")) {
    return false;
  }

  const running: SyncRequest = {
    ...request,
    status: "running",
    startedAt: request.startedAt ?? Date.now(),
  };
  await writeSyncRequest(running);

  try {
    await runSync();
    await writeSyncRequest({
      ...running,
      status: "success",
      completedAt: Date.now(),
      error: undefined,
    });
  } catch (error) {
    await writeSyncRequest({
      ...running,
      status: "error",
      completedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return true;
}
