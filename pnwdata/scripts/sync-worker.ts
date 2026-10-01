import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { startSyncLoop } = await import("../src/lib/sync");

  console.log("[Sync Worker] Starting local scheduled syncs");
  startSyncLoop();
}

main().catch(error => {
  console.error("[Sync Worker] Failed to start:", error);
  process.exitCode = 1;
});
