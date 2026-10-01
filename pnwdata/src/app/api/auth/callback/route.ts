// src/app/api/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, COOKIE_OPTIONS } from "@/lib/session";
import { exchangeDiscordOAuth } from "@/lib/darth-protocol";
import { getPublicOrigin } from "@/lib/site-url";

export async function GET(req: NextRequest) {
  const baseUrl = getPublicOrigin(req);
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = req.cookies.get("__oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", baseUrl));
  }

  let auth;
  try {
    auth = await exchangeDiscordOAuth(code);
  } catch (error) {
    console.error("[auth/callback] Darth Protocol OAuth exchange failed:", error);
    const reason = error instanceof Error && error.message === "not_member" ? "not_member" : "token_exchange";
    return NextResponse.redirect(new URL(`/login?error=${reason}`, baseUrl));
  }

  const token = await createSessionToken({
    discordId: auth.user.id,
    username: auth.user.username,
    avatar: auth.user.avatar,
    roleIds: auth.roleIds,
    isEmperor: auth.isAdmin,
  });

  const res = NextResponse.redirect(new URL("/", baseUrl));
  // Use res.cookies.set() for reliable multi-cookie writes
  res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
  res.cookies.set("__oauth_state", "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
