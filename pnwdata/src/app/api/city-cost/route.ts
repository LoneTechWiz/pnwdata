import { NextRequest, NextResponse } from "next/server";
import { gql } from "@/lib/sync";
import { MAX_TARGET_CITIES, parseNationIds, type CityCostModifiers } from "@/lib/city-cost";

export const dynamic = "force-dynamic";

const MAX_NATIONS = 50;

const NATIONS_QUERY = `
  query($id:[Int]) { nations(id:$id, first:${MAX_NATIONS}) { data {
    id nation_name leader_name num_cities domestic_policy
    urban_planning advanced_urban_planning metropolitan_planning government_support_agency
  } } }
`;

interface RawNation {
  id: string | number;
  nation_name: string;
  leader_name: string;
  num_cities: number;
  domestic_policy: string;
  urban_planning: boolean;
  advanced_urban_planning: boolean;
  metropolitan_planning: boolean;
  government_support_agency: boolean;
}

export interface CityCostNation {
  id: number;
  nationName: string;
  leaderName: string;
  cities: number;
  domesticPolicy: string;
  mods: CityCostModifiers;
}

export interface CityCostResponse {
  nations: CityCostNation[];
  /** Requested IDs that P&W has no nation for. */
  notFound: number[];
}

export async function GET(request: NextRequest) {
  const ids = parseNationIds(request.nextUrl.searchParams.get("ids") ?? "");
  if (ids.length === 0) return NextResponse.json({ error: "Enter at least one nation ID" }, { status: 400 });
  if (ids.length > MAX_NATIONS) {
    return NextResponse.json({ error: `Enter at most ${MAX_NATIONS} nation IDs` }, { status: 400 });
  }
  const target = Number(request.nextUrl.searchParams.get("target"));
  if (!Number.isInteger(target) || target < 2 || target > MAX_TARGET_CITIES) {
    return NextResponse.json({ error: `City target must be a whole number from 2 to ${MAX_TARGET_CITIES}` }, { status: 400 });
  }

  try {
    const data = await gql<{ nations: { data: RawNation[] } }>(NATIONS_QUERY, { id: ids });
    const byId = new Map(data.nations.data.map((n) => [Number(n.id), n]));
    // Keep the order the IDs were entered in.
    const nations: CityCostNation[] = ids.flatMap((id) => {
      const n = byId.get(id);
      if (!n) return [];
      return [{
        id,
        nationName: n.nation_name,
        leaderName: n.leader_name,
        cities: n.num_cities,
        domesticPolicy: n.domestic_policy,
        mods: {
          urbanPlanning: !!n.urban_planning,
          advancedUrbanPlanning: !!n.advanced_urban_planning,
          metropolitanPlanning: !!n.metropolitan_planning,
          manifestDestiny: n.domestic_policy === "MANIFEST_DESTINY",
          governmentSupportAgency: !!n.government_support_agency,
        },
      }];
    });
    const response: CityCostResponse = { nations, notFound: ids.filter((id) => !byId.has(id)) };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load nations";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
