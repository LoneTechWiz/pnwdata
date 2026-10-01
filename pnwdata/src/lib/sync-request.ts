import { supabase } from "./supabase";

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
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", SYNC_REQUEST_KEY)
    .maybeSingle();
  if (error) throw new Error(`Read sync request: ${error.message}`);
  return (data?.value as SyncRequest | undefined) ?? null;
}

async function writeSyncRequest(request: SyncRequest): Promise<void> {
  const { error } = await supabase.from("app_config").upsert({
    key: SYNC_REQUEST_KEY,
    value: request,
    updated_at: Date.now(),
  });
  if (error) throw new Error(`Write sync request: ${error.message}`);
}

export async function enqueueSyncRequest(): Promise<{ request: SyncRequest; created: boolean }> {
  const existing = await readSyncRequest();
  if (existing?.status === "pending" || existing?.status === "running") {
    return { request: existing, created: false };
  }

  const now = Date.now();
  const request: SyncRequest = {
    id: crypto.randomUUID(),
    status: "pending",
    requestedAt: now,
  };
  await writeSyncRequest(request);

  const { error } = await supabase
    .from("sync_status")
    .update({ status: "syncing", error: null })
    .eq("id", 1);
  if (error) throw new Error(`Queue sync status: ${error.message}`);

  return { request, created: true };
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
