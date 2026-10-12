import { readAppConfig, writeAppConfig } from "./app-config";
import { DEFAULT_SPHERES_CONFIG, validateSpheresConfig, type AllianceSpheresConfig } from "./alliance-spheres";

const CONFIG_KEY = "alliance-spheres-config";

/** The saved sphere config, or the defaults when nothing valid is saved yet. */
export async function readSpheresConfig(): Promise<AllianceSpheresConfig> {
  try {
    const result = validateSpheresConfig(await readAppConfig<unknown>(CONFIG_KEY));
    if ("config" in result) return result.config;
  } catch {
    // Nothing saved yet (or unreadable): use the defaults.
  }
  return DEFAULT_SPHERES_CONFIG;
}

export async function writeSpheresConfig(config: AllianceSpheresConfig): Promise<void> {
  await writeAppConfig(CONFIG_KEY, config);
}
