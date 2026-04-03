import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";

const WAR_CONFIG_PATH = join(process.cwd(), "data", "war-config.json");

interface WarConfig {
  enemy_alliance_ids: number[];
  ally_alliance_ids: number[];
}

function readWarConfig(): WarConfig {
  return JSON.parse(readFileSync(WAR_CONFIG_PATH, "utf-8"));
}

function writeWarConfig(config: WarConfig) {
  writeFileSync(WAR_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function canManage(session: Awaited<ReturnType<typeof getSession>>): boolean {
  if (!session) return false;
  const config = readRoleConfig();
  return session.isEmperor || hasAccess(config, "/war-config", session.roleIds);
}

export async function GET() {
  const session = await getSession();
  if (!canManage(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(readWarConfig());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!canManage(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as WarConfig;
  if (!Array.isArray(body.enemy_alliance_ids) || !Array.isArray(body.ally_alliance_ids)) {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }
  writeWarConfig({
    enemy_alliance_ids: body.enemy_alliance_ids.map(Number),
    ally_alliance_ids: body.ally_alliance_ids.map(Number),
  });
  return NextResponse.json({ ok: true });
}
