import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasAccess, readRoleConfig } from "@/lib/role-config";
import {
  addOffshoreAlliance,
  canManageOffshoreAlliance,
  getOffshoreAllianceRow,
  listOffshoreAlliances,
  removeOffshoreAlliance,
} from "@/lib/offshore-config";
import { syncOffshoreAlliance } from "@/lib/offshore-sync";

async function isAdmin(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): Promise<boolean> {
  const roleConfig = await readRoleConfig();
  return session.isEmperor || hasAccess(roleConfig, "/offshore-config", session.roleIds);
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(listOffshoreAlliances());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { apiKey?: string; label?: string | null };
  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  try {
    const entry = await addOffshoreAlliance({
      apiKey,
      label: body.label?.trim() || null,
      discordId: session.discordId,
      username: session.username,
    });
    void syncOffshoreAlliance(entry.allianceId);
    return NextResponse.json(entry);
  } catch (error) {
    return NextResponse.json({ error: `Could not verify that key: ${String(error)}` }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allianceId = Number(req.nextUrl.searchParams.get("allianceId"));
  if (!allianceId) return NextResponse.json({ error: "allianceId is required" }, { status: 400 });

  const row = getOffshoreAllianceRow(allianceId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!canManageOffshoreAlliance(row, session.discordId, await isAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  removeOffshoreAlliance(allianceId);
  return NextResponse.json({ ok: true });
}
