// src/app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { getPublicOrigin } from "@/lib/site-url";

export async function POST(req: NextRequest) {
  const baseUrl = getPublicOrigin(req);
  const res = NextResponse.redirect(new URL("/login", baseUrl));
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
