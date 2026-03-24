// src/app/api/auth/discord/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const getBaseUrl = () => new URL(process.env.DISCORD_REDIRECT_URI!).origin;

export async function GET() {
  return NextResponse.redirect(new URL("/login", getBaseUrl()));
}

export async function POST(req: NextRequest) {
  const baseUrl = getBaseUrl();

  // Parse Turnstile token from form body
  const formData = await req.formData();
  const cfToken = String(formData.get("cf-turnstile-response") ?? "");
  if (!cfToken) {
    return NextResponse.redirect(new URL("/login?error=captcha_failed", baseUrl));
  }

  // Guard: secret key must be configured
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error("[auth] TURNSTILE_SECRET_KEY is not configured");
    return NextResponse.redirect(new URL("/login?error=server_error", baseUrl));
  }

  // Build siteverify request body
  const verifyBody = new URLSearchParams({ secret: secretKey, response: cfToken });
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    verifyBody.set("remoteip", forwarded.split(",")[0].trim());
  }

  // Verify with Cloudflare (fail closed on network error)
  let verifyResult: { success: boolean };
  try {
    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v1/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verifyBody,
        signal: AbortSignal.timeout(5000),
      }
    );
    verifyResult = await verifyRes.json() as { success: boolean };
  } catch {
    return NextResponse.redirect(new URL("/login?error=server_error", baseUrl));
  }

  if (!verifyResult.success) {
    return NextResponse.redirect(new URL("/login?error=captcha_failed", baseUrl));
  }

  // Captcha passed — initiate Discord OAuth
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
    maxAge: 600,
    path: "/",
  });
  return res;
}
