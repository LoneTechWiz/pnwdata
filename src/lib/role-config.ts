// src/lib/role-config.ts
import fs from "fs";
import path from "path";

export interface RoleConfig {
  pages: Record<string, string[]>; // path → role ID array
}

const CONFIG_PATH = path.join(process.cwd(), "data", "role-config.json");

export function readRoleConfig(): RoleConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as RoleConfig;
  } catch {
    return { pages: {} };
  }
}

export function writeRoleConfig(config: RoleConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function hasAccess(config: RoleConfig, pathname: string, roleIds: string[]): boolean {
  const allowed = config.pages[pathname];
  if (!allowed) return false;
  return roleIds.some((id) => allowed.includes(id));
}
