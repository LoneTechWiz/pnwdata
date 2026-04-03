// src/app/api/auth/guild-roles/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";

export async function GET() {
  const session = await getSession();
  const config = readRoleConfig();
  const canManageRoles = session?.isEmperor || (session != null && hasAccess(config, "/role-config", session.roleIds));
  if (!canManageRoles) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/roles`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch guild roles" }, { status: 502 });
  }

  const roles = await res.json() as { id: string; name: string; color: number; position: number }[];
  const adminRole = process.env.DISCORD_ADMIN_ROLE ?? "Emperor";
  const filtered = roles
    .filter((r) => r.name !== "@everyone" && r.name !== adminRole)
    .sort((a, b) => b.position - a.position);

  return NextResponse.json(filtered);
}
