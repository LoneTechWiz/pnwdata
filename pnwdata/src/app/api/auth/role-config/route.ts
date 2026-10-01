// src/app/api/auth/role-config/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, writeRoleConfig, hasAccess, RoleConfig } from "@/lib/role-config";

async function canManage(session: Awaited<ReturnType<typeof getSession>>): Promise<boolean> {
  if (!session) return false;
  const config = await readRoleConfig();
  return session.isEmperor || hasAccess(config, "/role-config", session.roleIds);
}

export async function GET() {
  const session = await getSession();
  if (!(await canManage(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await readRoleConfig());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!(await canManage(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as RoleConfig;
  if (!body.pages || typeof body.pages !== "object") {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }
  await writeRoleConfig(body);
  return NextResponse.json({ ok: true });
}
