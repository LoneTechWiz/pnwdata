// src/lib/role-config.ts
export interface RoleConfig {
  pages: Record<string, string[]>; // path → role ID array
}

export const ADMIN_PAGE_PATHS = [
  "/dashboard",
  "/charts",
  "/members",
  "/applicants",
  "/relink",
  "/inactive",
  "/explore",
  "/stagnant-cities",
  "/military",
  "/mmr",
  "/wars",
  "/slots",
  "/command-center",
  "/beige-watch",
  "/raid-finder",
  "/tiering",
  "/cashholders",
  "/credits",
  "/recruitment",
  "/role-config",
  "/war-config",
  "/raid-config",
  "/stockpile-alert-config",
  "/offshore-config",
  "/revenue",
  "/tax-config",
] as const;

export async function readRoleConfig(): Promise<RoleConfig> {
  const { readAppConfig } = await import("./app-config");
  return readAppConfig<RoleConfig>("role-config");
}

export async function writeRoleConfig(config: RoleConfig): Promise<void> {
  const { writeAppConfig } = await import("./app-config");
  await writeAppConfig("role-config", config);
}

export function hasAccess(config: RoleConfig, pathname: string, roleIds: string[]): boolean {
  const allowed = config.pages[pathname];
  if (!allowed) return false;
  return roleIds.some((id) => allowed.includes(id));
}

export function accessiblePages(config: RoleConfig, roleIds: string[], isAdmin: boolean): string[] {
  if (isAdmin) return [...ADMIN_PAGE_PATHS];
  return Object.keys(config.pages).filter((pathname) => hasAccess(config, pathname, roleIds));
}
