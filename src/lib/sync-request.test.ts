import { beforeEach, describe, expect, it, vi } from "vitest";

let storedValue: unknown = null;
let syncStatus: Record<string, unknown> = { status: "success", error: null };

vi.mock("./supabase", () => ({
  supabase: {
    from(table: string) {
      if (table === "app_config") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: storedValue ? { value: storedValue } : null, error: null };
                  },
                };
              },
            };
          },
          async upsert(row: { value: unknown }) {
            storedValue = row.value;
            return { error: null };
          },
        };
      }

      if (table === "sync_status") {
        return {
          update(values: Record<string, unknown>) {
            return {
              async eq() {
                syncStatus = { ...syncStatus, ...values };
                return { error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

import { enqueueSyncRequest, processSyncRequest, type SyncRequest } from "./sync-request";

describe("sync request handoff", () => {
  beforeEach(() => {
    storedValue = null;
    syncStatus = { status: "success", error: "old error" };
  });

  it("queues a request and marks the visible sync status as syncing", async () => {
    const result = await enqueueSyncRequest();

    expect(result.created).toBe(true);
    expect(result.request.status).toBe("pending");
    expect(syncStatus).toEqual({ status: "syncing", error: null });
  });

  it("does not replace a request that is already pending", async () => {
    const first = await enqueueSyncRequest();
    const second = await enqueueSyncRequest();

    expect(second).toEqual({ request: first.request, created: false });
  });

  it("runs a queued request and records completion", async () => {
    await enqueueSyncRequest();
    const runSync = vi.fn().mockResolvedValue(undefined);

    await expect(processSyncRequest(runSync)).resolves.toBe(true);

    expect(runSync).toHaveBeenCalledOnce();
    expect(storedValue).toMatchObject({ status: "success" });
    expect((storedValue as SyncRequest).completedAt).toEqual(expect.any(Number));
  });

  it("records a failed local sync and rethrows the error", async () => {
    await enqueueSyncRequest();
    const runSync = vi.fn().mockRejectedValue(new Error("PnW unavailable"));

    await expect(processSyncRequest(runSync)).rejects.toThrow("PnW unavailable");
    expect(storedValue).toMatchObject({ status: "error", error: "PnW unavailable" });
  });
});
