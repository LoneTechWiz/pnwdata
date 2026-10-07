import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasAccess, readRoleConfig } from "@/lib/role-config";
import { readAppConfig, writeAppConfig } from "@/lib/app-config";
import { STAGNANT_DEFAULTS, validateStagnantConfig, type StagnantCitiesConfig } from "@/lib/stagnant-config";

export const dynamic = "force-dynamic";

const CONFIG_KEY = "stagnant-cities-config";

async function canManage(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const roleConfig = await readRoleConfig();
  return session.isEmperor || hasAccess(roleConfig, "/stagnant-cities-config", session.roleIds);
}

async function readConfig(): Promise<StagnantCitiesConfig> {
  try {
    const result = validateStagnantConfig(await readAppConfig<unknown>(CONFIG_KEY));
    if ("config" in result) return result.config;
  } catch {
    // Nothing saved yet (or unreadable): fall back to the built-in defaults.
  }
  return STAGNANT_DEFAULTS;
}

// Anyone who can open the Stagnant Cities page needs the defaults, and they aren't sensitive.
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
  const result = validateStagnantConfig(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  await writeAppConfig(CONFIG_KEY, result.config);
  return NextResponse.json(result.config);
}
