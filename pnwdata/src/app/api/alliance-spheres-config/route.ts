import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasAccess, readRoleConfig } from "@/lib/role-config";
import { getAllianceSnapshot } from "@/lib/alliance-data";
import { TOP_ALLIANCES, validateSpheresConfig } from "@/lib/alliance-spheres";
import { readSpheresConfig, writeSpheresConfig } from "@/lib/alliance-spheres-config";

export const dynamic = "force-dynamic";

async function canManage(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const roleConfig = await readRoleConfig();
  return session.isEmperor || hasAccess(roleConfig, "/alliance-spheres-config", session.roleIds);
}

export async function GET() {
  if (!(await canManage())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const [snapshot, config] = await Promise.all([getAllianceSnapshot(), readSpheresConfig()]);
    const selected = new Set(config.spheres.flatMap((sphere) => sphere.alliance_ids));
    // The top alliances by score, plus anything already in a sphere that has since fallen out of the top.
    const options = snapshot.alliances
      .filter((alliance, index) => index < TOP_ALLIANCES || selected.has(Number(alliance.id)))
      .map((alliance, index) => ({
        id: Number(alliance.id),
        name: alliance.name,
        acronym: alliance.acronym,
        score: alliance.score,
        nations: alliance.nation_count,
        rank: alliance.rank,
        inTop: index < TOP_ALLIANCES,
      }));
    return NextResponse.json({ config, options });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load alliances";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await canManage())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = validateSpheresConfig(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  await writeSpheresConfig(result.config);
  return NextResponse.json(result.config);
}
