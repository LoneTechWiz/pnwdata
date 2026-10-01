// src/app/api/auth/guild-roles/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";
import { getDiscordGuildRoles } from "@/lib/darth-protocol";

export async function GET() {
  const session = await getSession();
  const config = await readRoleConfig();
  const canManageRoles = session?.isEmperor || (session != null && hasAccess(config, "/role-config", session.roleIds));
  if (!canManageRoles) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let roles;
  try {
    roles = await getDiscordGuildRoles();
  } catch (error) {
    console.error("[auth/guild-roles] Darth Protocol request failed:", error);
    return NextResponse.json({ error: "Failed to fetch guild roles" }, { status: 502 });
  }
  const filtered = roles
    .filter((r) => r.name !== "@everyone" && !r.isAdmin)
    .sort((a, b) => b.position - a.position);

  return NextResponse.json(filtered);
}
