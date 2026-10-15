import { NextRequest, NextResponse } from "next/server";
import { gql } from "@/lib/sync";
import { getAllianceSnapshot } from "@/lib/alliance-data";
import { buildSphereStats, expandSpheres } from "@/lib/alliance-spheres";
import { readSpheresConfig } from "@/lib/alliance-spheres-config";
import { computeSphereTiering } from "@/lib/sphere-tiering";
import type { TieringNation } from "@/lib/tiering";

export const dynamic = "force-dynamic";

const CACHE_MS = 10 * 60 * 1000;
const MEMBERS_QUERY = `
  query($alliance_id:[Int], $page:Int) { nations(alliance_id:$alliance_id, vmode:false, first:500, page:$page) { data { id num_cities alliance_id alliance_position } } }
`;

let cache: { key: string; fetchedAt: number; nations: TieringNation[] } | null = null;

async function loadNations(allianceIds: number[]): Promise<TieringNation[]> {
  const key = [...allianceIds].sort((a, b) => a - b).join(",");
  if (cache && cache.key === key && Date.now() - cache.fetchedAt < CACHE_MS) return cache.nations;

  const nations: TieringNation[] = [];
  for (let page = 1; page <= 40; page++) {
    const data = await gql<{ nations: { data: { id: number; num_cities: number; alliance_id: number; alliance_position: string }[] } }>(
      MEMBERS_QUERY, { alliance_id: allianceIds, page },
    );
    const batch = data.nations.data;
    for (const n of batch) {
      if (n.alliance_position === "APPLICANT") continue;
      nations.push({ id: Number(n.id), alliance_id: Number(n.alliance_id), num_cities: n.num_cities });
    }
    if (batch.length < 500) break;
  }
  cache = { key, fetchedAt: Date.now(), nations };
  return nations;
}

export async function GET(request: NextRequest) {
  const bucketParam = Number(request.nextUrl.searchParams.get("bucketSize") ?? "5");
  const bucketSize = [1, 5, 10].includes(bucketParam) ? bucketParam : 5;

  try {
    const [snapshot, saved] = await Promise.all([getAllianceSnapshot(), readSpheresConfig()]);
    // Include each configured alliance's extensions and offshores, as Alliance Rankings does.
    const { config, linkTypes } = expandSpheres(saved, snapshot.alliances);
    const allianceIds = [...new Set(config.spheres.flatMap((s) => s.alliance_ids))];
    const rows = allianceIds.length > 0
      ? computeSphereTiering(await loadNations(allianceIds), config.spheres, bucketSize)
      : [];
    return NextResponse.json({
      fetchedAt: snapshot.fetchedAt,
      spheres: config.spheres.map((s) => s.name),
      rows,
      totals: config.spheres.map((_, i) => rows.reduce((sum, r) => sum + r.counts[i], 0)),
      hasAlliances: allianceIds.length > 0,
      stats: buildSphereStats(config, snapshot.alliances, linkTypes),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sphere tiering";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
