import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";
import { readTaxRevenueSummary } from "@/lib/tax-revenue";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await readRoleConfig();
  const canView = session.isEmperor || hasAccess(config, "/revenue", session.roleIds);
  if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(readTaxRevenueSummary());
}
