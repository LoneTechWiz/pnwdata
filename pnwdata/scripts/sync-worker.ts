import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { startSyncLoop } = await import("../src/lib/sync");
  const { startOffshoreSyncLoop } = await import("../src/lib/offshore-sync");

  console.log("[Sync Worker] Starting local scheduled syncs");
  startSyncLoop();
  startOffshoreSyncLoop();
}

main().catch(error => {
  console.error("[Sync Worker] Failed to start:", error);
  process.exitCode = 1;
});
