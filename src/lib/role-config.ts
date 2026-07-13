// src/lib/role-config.ts
export interface RoleConfig {
  pages: Record<string, string[]>; // path → role ID array
}

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
