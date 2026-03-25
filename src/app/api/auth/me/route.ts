// src/app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";
import db from "@/lib/db";

const SEND_WAR_TARGETS_ROLES = ["archduke", "viceroy", "defense peeps"];

let cachedGuildRoles: { id: string; name: string }[] = [];
let guildRoleCacheTime = 0;
const GUILD_ROLE_CACHE_TTL = 10 * 60 * 1000;

async function getGuildRoles(): Promise<{ id: string; name: string }[]> {
  if (Date.now() - guildRoleCacheTime < GUILD_ROLE_CACHE_TTL) return cachedGuildRoles;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/roles`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
    if (res.ok) {
      cachedGuildRoles = await res.json() as { id: string; name: string }[];
      guildRoleCacheTime = Date.now();
    }
  } catch { /* use stale cache */ }
  return cachedGuildRoles;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = readRoleConfig();
  const canManageRoles = session.isEmperor || hasAccess(config, "/role-config", session.roleIds);
  const accessiblePages = session.isEmperor
    ? Object.keys(config.pages)
    : Object.keys(config.pages).filter((p) => hasAccess(config, p, session.roleIds));
  // Look up the user's nation by matching their Discord username
  const row = db.prepare(
    `SELECT id FROM nations WHERE LOWER(json_extract(data, '$.discord')) = LOWER(?) LIMIT 1`
  ).get(session.username) as { id: number } | undefined;

  const guildRoles = await getGuildRoles();
  const userRoleNames = guildRoles
    .filter(r => session.roleIds.includes(r.id))
    .map(r => r.name.toLowerCase());
  const canSendWarTargets = session.isEmperor ||
    SEND_WAR_TARGETS_ROLES.some(name => userRoleNames.includes(name));

  return NextResponse.json({
    discordId: session.discordId,
    username: session.username,
    avatar: session.avatar,
    isEmperor: session.isEmperor,
    canManageRoles,
    canSendWarTargets,
    accessiblePages,
    nationId: row?.id ?? null,
  });
}
