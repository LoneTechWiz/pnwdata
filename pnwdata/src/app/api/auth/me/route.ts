// src/app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { COOKIE_OPTIONS, createSessionToken, getSession, SESSION_COOKIE } from "@/lib/session";
import { accessiblePages, readRoleConfig, hasAccess } from "@/lib/role-config";
import { findNationByDiscordId } from "@/lib/db";
import { getDiscordGuildMember, getDiscordGuildRoles } from "@/lib/darth-protocol";

const SEND_WAR_TARGETS_ROLES = ["archduke", "viceroy", "defense peeps"];

let cachedGuildRoles: { id: string; name: string; isAdmin?: boolean }[] = [];
let guildRoleCacheTime = 0;
const GUILD_ROLE_CACHE_TTL = 10 * 60 * 1000;

async function getGuildRoles(): Promise<{ id: string; name: string; isAdmin?: boolean }[]> {
  if (Date.now() - guildRoleCacheTime < GUILD_ROLE_CACHE_TTL) return cachedGuildRoles;
  try {
    cachedGuildRoles = await getDiscordGuildRoles();
    guildRoleCacheTime = Date.now();
  } catch { /* use stale cache */ }
  return cachedGuildRoles;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await readRoleConfig();
  const guildRoles = await getGuildRoles();
  let roleIds = session.roleIds;
  let isAdmin = session.isEmperor;
  try {
    const member = await getDiscordGuildMember(session.discordId);
    roleIds = member.roles;
    isAdmin = guildRoles.some((role) => role.isAdmin && roleIds.includes(role.id));
  } catch (error) {
    console.error("[auth/me] Live Discord role refresh failed; using signed session roles:", error);
  }

  const canManageRoles = isAdmin || hasAccess(config, "/role-config", roleIds);
  const pages = accessiblePages(config, roleIds, isAdmin);
  const row = findNationByDiscordId(session.discordId);

  const userRoleNames = guildRoles
    .filter(r => roleIds.includes(r.id))
    .map(r => r.name.toLowerCase());
  const canSendWarTargets = isAdmin ||
    SEND_WAR_TARGETS_ROLES.some(name => userRoleNames.includes(name));

  const response = NextResponse.json({
    discordId: session.discordId,
    username: session.username,
    avatar: session.avatar,
    isEmperor: isAdmin,
    canManageRoles,
    canSendWarTargets,
    accessiblePages: pages,
    nationId: row?.id ?? null,
  });

  if (isAdmin !== session.isEmperor || roleIds.join(",") !== session.roleIds.join(",")) {
    const token = await createSessionToken({
      discordId: session.discordId,
      username: session.username,
      avatar: session.avatar,
      roleIds,
      isEmperor: isAdmin,
    });
    response.cookies.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
  }
  return response;
}
