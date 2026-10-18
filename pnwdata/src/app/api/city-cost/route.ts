import { NextRequest, NextResponse } from "next/server";
import { gql } from "@/lib/sync";
import { MAX_TARGET_CITIES, parseNationIds, type CityCostModifiers } from "@/lib/city-cost";

export const dynamic = "force-dynamic";

const MAX_NATIONS = 50;

const NATIONS_QUERY = `
  query($id:[Int]) {
    game_info { city_average }
    nations(id:$id, first:${MAX_NATIONS}) { data {
      id nation_name leader_name num_cities domestic_policy
      government_support_agency bureau_of_domestic_affairs cities_discount
    } }
  }
`;

interface RawNation {
  id: string | number;
  nation_name: string;
  leader_name: string;
  num_cities: number;
  domestic_policy: string;
  government_support_agency: boolean;
  bureau_of_domestic_affairs: boolean;
  cities_discount: number | null;
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
  /** The game's average city count, an input to the city cost formula. */
  cityAverage: number;
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
    const data = await gql<{ game_info: { city_average: number }; nations: { data: RawNation[] } }>(NATIONS_QUERY, { id: ids });
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
          manifestDestiny: n.domestic_policy === "MANIFEST_DESTINY",
          governmentSupportAgency: !!n.government_support_agency,
          bureauOfDomesticAffairs: !!n.bureau_of_domestic_affairs,
          citiesDiscount: n.cities_discount ?? 0,
        },
      }];
    });
    const response: CityCostResponse = { cityAverage: data.game_info.city_average, nations, notFound: ids.filter((id) => !byId.has(id)) };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load nations";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
