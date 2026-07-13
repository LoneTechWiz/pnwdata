import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";
import { readAppConfig, writeAppConfig } from "@/lib/app-config";

interface WarConfig {
  enemy_alliance_ids: number[];
  ally_alliance_ids: number[];
}

async function canManage(session: Awaited<ReturnType<typeof getSession>>): Promise<boolean> {
  if (!session) return false;
  const config = await readRoleConfig();
  return session.isEmperor || hasAccess(config, "/war-config", session.roleIds);
}

export async function GET() {
  const session = await getSession();
  if (!(await canManage(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await readAppConfig<WarConfig>("war-config"));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!(await canManage(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as WarConfig;
  if (!Array.isArray(body.enemy_alliance_ids) || !Array.isArray(body.ally_alliance_ids)) {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }
  await writeAppConfig("war-config", {
    enemy_alliance_ids: body.enemy_alliance_ids.map(Number),
    ally_alliance_ids: body.ally_alliance_ids.map(Number),
  });
  return NextResponse.json({ ok: true });
}
