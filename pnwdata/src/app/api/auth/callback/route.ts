// src/app/api/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, COOKIE_OPTIONS } from "@/lib/session";

const GUILD_ID = process.env.DISCORD_GUILD_ID!;
const ADMIN_ROLE = process.env.DISCORD_ADMIN_ROLE ?? "Emperor";

export async function GET(req: NextRequest) {
  const baseUrl = new URL(process.env.DISCORD_REDIRECT_URI!).origin;
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = req.cookies.get("__oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", baseUrl));
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI!,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/login?error=token_exchange", baseUrl));
  }

  const { access_token } = await tokenRes.json() as { access_token: string };

  // Fetch the user's identity from the OAuth token
  const userRes = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) {
    const body = await userRes.text();
    console.error(`[auth/callback] user fetch failed: status=${userRes.status} body=${body}`);
    return NextResponse.redirect(new URL("/login?error=token_exchange", baseUrl));
  }

  const user = await userRes.json() as { id: string; username: string; avatar: string | null };

  // Look up the member via bot token (avoids aggressive rate limit on /users/@me/guilds/:id/member)
  const memberRes = await fetch(
    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${user.id}`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
  );

  if (!memberRes.ok) {
    const body = await memberRes.text();
    console.error(`[auth/callback] guild member fetch failed: status=${memberRes.status} guildId=${GUILD_ID} userId=${user.id} body=${body}`);
    return NextResponse.redirect(new URL("/login?error=not_member", baseUrl));
  }

  const memberData = await memberRes.json() as { roles: string[] };
  const member = { roles: memberData.roles, user };

  // Fetch guild roles to resolve Emperor by name using bot token
  const rolesRes = await fetch(
    `https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
  );

  let isEmperor = false;
  if (rolesRes.ok) {
    const guildRoles = await rolesRes.json() as { id: string; name: string }[];
    // ADMIN_ROLE can be a role name or a numeric role ID snowflake
    const isSnowflake = /^\d+$/.test(ADMIN_ROLE);
    const emperorRole = isSnowflake
      ? guildRoles.find((r) => r.id === ADMIN_ROLE)
      : guildRoles.find((r) => r.name === ADMIN_ROLE);
    if (emperorRole) {
      isEmperor = member.roles.includes(emperorRole.id);
    }
  }

  const token = await createSessionToken({
    discordId: member.user.id,
    username: member.user.username,
    avatar: member.user.avatar,
    roleIds: member.roles,
    isEmperor,
  });

  const res = NextResponse.redirect(new URL("/", baseUrl));
  // Use res.cookies.set() for reliable multi-cookie writes
  res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
  res.cookies.set("__oauth_state", "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
