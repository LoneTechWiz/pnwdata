import { beforeEach, describe, expect, it, vi } from "vitest";

let storedValue: unknown = null;
let syncStatus: Record<string, unknown> = { status: "success", error: null };

vi.mock("./db", () => ({
  default: {
    prepare(sql: string) {
      if (sql.includes("SELECT value FROM app_config")) {
        return {
          get: () => storedValue == null ? undefined : { value: JSON.stringify(storedValue) },
        };
      }
      if (sql.includes("INSERT INTO app_config")) {
        return {
          run: (_key: string, value: string) => {
            storedValue = JSON.parse(value);
            return { changes: 1 };
          },
        };
      }
      if (sql.includes("UPDATE sync_status")) {
        return {
          run: () => {
            syncStatus = { status: "syncing", error: null };
            return { changes: 1 };
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    transaction<T extends () => unknown>(operation: T): T {
      return operation;
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
