import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";

const CONFIG_PATH = join(process.cwd(), "data", "stockpile-alert-config.json");

interface StockpileAlertConfig {
  enabled: boolean;
  thresholds: Record<string, number | null>;
}

function readConfig(): StockpileAlertConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function writeConfig(config: StockpileAlertConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function canManage(session: Awaited<ReturnType<typeof getSession>>): boolean {
  if (!session) return false;
  const config = readRoleConfig();
  return session.isEmperor || hasAccess(config, "/stockpile-alert-config", session.roleIds);
}

export async function GET() {
  const session = await getSession();
  if (!canManage(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(readConfig());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!canManage(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as StockpileAlertConfig;
  if (typeof body.enabled !== "boolean" || typeof body.thresholds !== "object") {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }
  writeConfig({
    enabled: body.enabled,
    thresholds: Object.fromEntries(
      Object.entries(body.thresholds).map(([k, v]) => [k, v != null ? Number(v) : null])
    ),
  });
  return NextResponse.json({ ok: true });
}
