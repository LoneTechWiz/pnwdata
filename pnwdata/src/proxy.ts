// src/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";


const PUBLIC_PREFIXES = ["/_next/", "/favicon.ico", "/api/"];

const PUBLIC_EXACT = new Set([
  "/",
  "/war-targets",
  "/conflict",
  "/login",
  "/403",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get("__session")?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Emperor bypasses all role checks
  if (session.isEmperor) return NextResponse.next();

  // Check the Supabase-backed role configuration for protected routes.
  const config = await readRoleConfig();
  if (hasAccess(config, pathname, session.roleIds)) {
    return NextResponse.next();
  }

  return NextResponse.rewrite(new URL("/403", req.url));
}
