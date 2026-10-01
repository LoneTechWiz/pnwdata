import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";
import { readTaxBracketConfigs, writeTaxBracketRealRates } from "@/lib/tax-revenue";

async function canManage(session: Awaited<ReturnType<typeof getSession>>): Promise<boolean> {
  if (!session) return false;
  const config = await readRoleConfig();
  return session.isEmperor || hasAccess(config, "/tax-config", session.roleIds);
}

export async function GET() {
  const session = await getSession();
  if (!(await canManage(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(readTaxBracketConfigs());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!(await canManage(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as { allianceId?: number; bracketId?: number; realMoneyRate?: number; realResourceRate?: number };
  const allianceId = Number(body.allianceId);
  const bracketId = Number(body.bracketId);
  const realMoneyRate = Number(body.realMoneyRate);
  const realResourceRate = Number(body.realResourceRate);
  if (!allianceId || !bracketId) {
    return NextResponse.json({ error: "allianceId and bracketId are required" }, { status: 400 });
  }

  try {
    writeTaxBracketRealRates(allianceId, bracketId, realMoneyRate, realResourceRate);
  } catch (error) {
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
