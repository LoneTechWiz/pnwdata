import { readAppConfig, writeAppConfig } from "./app-config";

export interface RaidFinderConfig {
  min_inactive_days: number;
}

export const MIN_INACTIVE_DAYS = 1;
export const MAX_INACTIVE_DAYS = 365;

export async function readRaidFinderConfig(): Promise<RaidFinderConfig> {
  return readAppConfig<RaidFinderConfig>("raid-finder-config");
}

export function validateRaidFinderConfig(value: unknown): RaidFinderConfig | null {
  if (!value || typeof value !== "object") return null;
  const days = Number((value as { min_inactive_days?: unknown }).min_inactive_days);
  if (!Number.isInteger(days) || days < MIN_INACTIVE_DAYS || days > MAX_INACTIVE_DAYS) return null;
  return { min_inactive_days: days };
}

export async function writeRaidFinderConfig(config: RaidFinderConfig): Promise<void> {
  await writeAppConfig("raid-finder-config", config);
}
