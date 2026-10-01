import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasAccess, readRoleConfig } from "@/lib/role-config";
import {
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
  readRaidFinderConfig,
  validateRaidFinderConfig,
  writeRaidFinderConfig,
} from "@/lib/raid-config";

async function canManage(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const roleConfig = await readRoleConfig();
  return session.isEmperor || hasAccess(roleConfig, "/raid-config", session.roleIds);
}

export async function GET() {
  if (!(await canManage())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await readRaidFinderConfig());
}

export async function POST(request: NextRequest) {
  if (!(await canManage())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const config = validateRaidFinderConfig(await request.json());
  if (!config) {
    return NextResponse.json({
      error: `Minimum inactivity must be a whole number from ${MIN_INACTIVE_DAYS} to ${MAX_INACTIVE_DAYS} days`,
    }, { status: 400 });
  }
  await writeRaidFinderConfig(config);
  return NextResponse.json(config);
}
