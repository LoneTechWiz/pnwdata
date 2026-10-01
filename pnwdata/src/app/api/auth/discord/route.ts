// src/app/api/auth/discord/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getDiscordAuthorizeUrl } from "@/lib/darth-protocol";
import { getPublicUrl } from "@/lib/site-url";

export async function GET(req: NextRequest) {
  const state = randomBytes(16).toString("hex");

  let discordUrl: string;
  try {
    ({ url: discordUrl } = await getDiscordAuthorizeUrl(state));
  } catch (error) {
    console.error("[auth/discord] Darth Protocol request failed:", error);
    return NextResponse.redirect(getPublicUrl("/login?error=oauth_unavailable", req));
  }

  const res = NextResponse.redirect(discordUrl);
  res.cookies.set("__oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}
