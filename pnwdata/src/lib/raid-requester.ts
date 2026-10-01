const PNW_API = "https://api.politicsandwar.com/graphql";

export interface RaidRequesterNation {
  id: number;
  nation_name: string;
  leader_name: string;
  score: number;
  alliance_id: number;
}

export interface RaidRequesterWar {
  att_id: number;
  def_id: number;
}

export interface RaidRequesterContext {
  nation: RaidRequesterNation | null;
  activeWars: RaidRequesterWar[];
}

interface RequesterQueryResponse {
  data?: {
    nations: { data: Array<Omit<RaidRequesterNation, "id" | "score" | "alliance_id"> & {
      id: number | string;
      score: number | string;
      alliance_id: number | string;
    }> };
    wars: { data: Array<{ att_id: number | string; def_id: number | string }> };
  };
  errors?: Array<{ message: string }>;
}

const REQUESTER_QUERY = `
  query($nationId:[Int]) {
    nations(id:$nationId, first:1) {
      data { id nation_name leader_name score alliance_id }
    }
    wars(nation_id:$nationId, active:true, first:20) {
      data { att_id def_id }
    }
  }
`;

export async function fetchRaidRequesterContext(
  nationId: number,
  options: {
    apiKey?: string;
    fetcher?: typeof fetch;
  } = {},
): Promise<RaidRequesterContext> {
  const apiKey = options.apiKey ?? process.env.PNW_API_KEY;
  if (!apiKey) throw new Error("PNW_API_KEY is not configured");

  const response = await (options.fetcher ?? fetch)(
    `${PNW_API}?api_key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: REQUESTER_QUERY, variables: { nationId: [nationId] } }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`P&W API HTTP ${response.status}`);

  const result = await response.json() as RequesterQueryResponse;
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join("; "));
  }
  if (!result.data) throw new Error("P&W API returned no data");

  const nation = result.data.nations.data[0];
  return {
    nation: nation ? {
      ...nation,
      id: Number(nation.id),
      score: Number(nation.score),
      alliance_id: Number(nation.alliance_id),
    } : null,
    activeWars: result.data.wars.data.map((war) => ({
      att_id: Number(war.att_id),
      def_id: Number(war.def_id),
    })),
  };
}
