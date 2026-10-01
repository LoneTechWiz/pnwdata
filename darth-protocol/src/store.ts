import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AlertSummary, GuildSettings, WatchState } from "./types.js";

const statePath = resolve("data/state.json");
let state: WatchState = { guilds: {}, registrations: {}, alertedOffers: [], alertSummaries: {} };
let pendingPersist: Promise<void> = Promise.resolve();

export async function loadState() {
  try {
    const raw = JSON.parse(await readFile(statePath, "utf8")) as Partial<WatchState>;
    state = {
      // Keep existing scan intervals while retiring channel configuration.
      guilds: Object.fromEntries(Object.entries(raw.guilds ?? {}).map(([id, settings]) => [id, { intervalSeconds: settings.intervalSeconds }])),
      registrations: raw.registrations ?? {},
      alertedOffers: raw.alertedOffers ?? [],
      alertSummaries: raw.alertSummaries ?? {},
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function getGuildSettings(guildId: string): GuildSettings | undefined {
  return state.guilds[guildId];
}

export function configuredGuildIds(): string[] {
  return Object.keys(state.guilds);
}

export async function saveGuildSettings(guildId: string, settings: GuildSettings) {
  state.guilds[guildId] = settings;
  await persist();
}

export function isRegistered(guildId: string, memberId: string): boolean {
  return state.registrations[guildId]?.includes(memberId) ?? false;
}

export async function registerMember(guildId: string, memberId: string) {
  const members = state.registrations[guildId] ?? [];
  state.registrations[guildId] = [...new Set([...members, memberId])];
  await persist();
}

export async function unregisterMember(guildId: string, memberId: string) {
  state.registrations[guildId] = (state.registrations[guildId] ?? []).filter((id) => id !== memberId);
  // Re-registering should allow a fresh alert, even before the next scan.
  state.alertedOffers = state.alertedOffers.filter((key) => !key.startsWith(`${guildId}:${memberId}:`));
  await persist();
}

export function hasAlerted(key: string): boolean {
  return state.alertedOffers.includes(key);
}

export function getAlertSummary(summaryId: string): AlertSummary | undefined {
  return state.alertSummaries[summaryId];
}

export async function saveAlertSummary(summaryId: string, summary: AlertSummary) {
  state.alertSummaries[summaryId] = summary;
  await persist();
}

export async function removeAlertSummary(summaryId: string) {
  delete state.alertSummaries[summaryId];
  await persist();
}

/**
 * Replaces alert state only for servers just scanned, preserving quiet servers
 * until their own next scan. This allows a later re-alert without duplicate pings.
 */
export async function replaceAlertedOffers(keys: Iterable<string>, scannedGuildIds: Iterable<string>) {
  const prefixes = new Set([...scannedGuildIds].map((id) => `${id}:`));
  const retained = state.alertedOffers.filter((key) => ![...prefixes].some((prefix) => key.startsWith(prefix)));
  const current = [...keys].filter((key) => {
    const [guildId, memberId] = key.split(":");
    return isRegistered(guildId, memberId);
  });
  state.alertedOffers = [...new Set([...retained, ...current])];
  await persist();
}

function persist(): Promise<void> {
  const snapshot = `${JSON.stringify(state, null, 2)}\n`;
  // Slash commands and scans can save concurrently; serialize atomic writes.
  const operation = pendingPersist.then(async () => {
    await mkdir(dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.tmp`;
    await writeFile(temporaryPath, snapshot, "utf8");
    await rename(temporaryPath, statePath);
  });
  pendingPersist = operation.catch(() => {});
  return operation;
}
