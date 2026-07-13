import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";
import { readAppConfig, writeAppConfig } from "@/lib/app-config";

interface StockpileAlertConfig {
  enabled: boolean;
  thresholds: Record<string, number | null>;
}

async function canManage(session: Awaited<ReturnType<typeof getSession>>): Promise<boolean> {
  if (!session) return false;
  const config = await readRoleConfig();
  return session.isEmperor || hasAccess(config, "/stockpile-alert-config", session.roleIds);
}

export async function GET() {
  const session = await getSession();
  if (!(await canManage(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await readAppConfig<StockpileAlertConfig>("stockpile-alert-config"));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!(await canManage(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as StockpileAlertConfig;
  if (typeof body.enabled !== "boolean" || typeof body.thresholds !== "object") {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }
  await writeAppConfig("stockpile-alert-config", {
    enabled: body.enabled,
    thresholds: Object.fromEntries(
      Object.entries(body.thresholds).map(([k, v]) => [k, v != null ? Number(v) : null])
    ),
  });
  return NextResponse.json({ ok: true });
}
