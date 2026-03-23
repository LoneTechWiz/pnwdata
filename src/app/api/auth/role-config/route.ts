// src/app/api/auth/role-config/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, writeRoleConfig, RoleConfig } from "@/lib/role-config";

export async function GET() {
  const session = await getSession();
  if (!session?.isEmperor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(readRoleConfig());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.isEmperor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as RoleConfig;
  if (!body.pages || typeof body.pages !== "object") {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }
  writeRoleConfig(body);
  return NextResponse.json({ ok: true });
}
