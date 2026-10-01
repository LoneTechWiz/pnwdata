import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { GuildSettings, WatchState } from "./types.js";

const statePath = resolve("data/state.json");
let state: WatchState = { guilds: {}, alertedOffers: [] };

export async function loadState() {
  try {
    const raw = JSON.parse(await readFile(statePath, "utf8")) as Partial<WatchState>;
    state = {
      guilds: raw.guilds ?? {},
      alertedOffers: raw.alertedOffers ?? [],
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

export function hasAlerted(key: string): boolean {
  return state.alertedOffers.includes(key);
}

/**
 * Replaces alert state only for servers just scanned, preserving quiet servers
 * until their own next scan. This allows a later re-alert without duplicate pings.
 */
export async function replaceAlertedOffers(keys: Iterable<string>, scannedGuildIds: Iterable<string>) {
  const prefixes = new Set([...scannedGuildIds].map((id) => `${id}:`));
  const retained = state.alertedOffers.filter((key) => ![...prefixes].some((prefix) => key.startsWith(prefix)));
  state.alertedOffers = [...new Set([...retained, ...keys])];
  await persist();
}

async function persist() {
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}
