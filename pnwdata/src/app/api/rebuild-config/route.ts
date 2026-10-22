import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasAccess, readRoleConfig } from "@/lib/role-config";
import { readAppConfig, writeAppConfig } from "@/lib/app-config";
import { REBUILD_DEFAULTS, validateRebuildConfig, type RebuildConfig } from "@/lib/rebuild-cost";

export const dynamic = "force-dynamic";

const CONFIG_KEY = "rebuild-config";

async function canManage(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const roleConfig = await readRoleConfig();
  return session.isEmperor || hasAccess(roleConfig, "/rebuild-config", session.roleIds);
}

async function readConfig(): Promise<RebuildConfig> {
  try {
    const result = validateRebuildConfig(await readAppConfig<unknown>(CONFIG_KEY));
    if ("config" in result) return result.config;
  } catch {
    // Nothing saved yet (or unreadable): fall back to the built-in defaults.
  }
  return REBUILD_DEFAULTS;
}

// Anyone who can open the Rebuild Cost page needs these inputs, and they aren't sensitive.
export async function GET() {
  return NextResponse.json(await readConfig());
}

export async function POST(request: NextRequest) {
  if (!(await canManage())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = validateRebuildConfig(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  await writeAppConfig(CONFIG_KEY, result.config);
  return NextResponse.json(result.config);
}
