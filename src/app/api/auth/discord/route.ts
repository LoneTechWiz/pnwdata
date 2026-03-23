// src/app/api/auth/discord/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

export async function GET() {
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: process.env.DISCORD_REDIRECT_URI!,
    response_type: "code",
    scope: "identify guilds.members.read",
    state,
  });

  const discordUrl = `https://discord.com/oauth2/authorize?${params}`;

  const res = NextResponse.redirect(discordUrl);
  res.cookies.set("__oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}
