import { NextResponse } from "next/server";
import { getAllianceSnapshot } from "@/lib/alliance-data";
import { buildAllianceGroups } from "@/lib/alliance-rankings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getAllianceSnapshot();
    return NextResponse.json({
      fetchedAt: snapshot.fetchedAt,
      groups: buildAllianceGroups(snapshot.alliances, 20),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load alliance rankings";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
