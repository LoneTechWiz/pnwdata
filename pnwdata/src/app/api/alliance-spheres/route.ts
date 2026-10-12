import { NextResponse } from "next/server";
import { getAllianceSnapshot } from "@/lib/alliance-data";
import { buildSphereStats } from "@/lib/alliance-spheres";
import { readSpheresConfig } from "@/lib/alliance-spheres-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [snapshot, config] = await Promise.all([getAllianceSnapshot(), readSpheresConfig()]);
    return NextResponse.json({
      fetchedAt: snapshot.fetchedAt,
      worldScore: snapshot.alliances.reduce((sum, a) => sum + a.score, 0),
      spheres: buildSphereStats(config, snapshot.alliances),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load alliance spheres";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
