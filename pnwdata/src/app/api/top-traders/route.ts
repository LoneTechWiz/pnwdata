import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { gql } from "@/lib/sync";
import {
  DEFAULT_TRADER_WINDOW_DAYS, TRADER_WINDOWS_DAYS, queryTraderTotals, rankTraders, type TraderProfit,
} from "@/lib/trader-profit";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const NAMES_QUERY = `
  query($id:[Int]) { nations(id:$id, first:100) { data { id nation_name leader_name alliance { id name } } } }
`;

export interface TopTrader extends TraderProfit {
  nationName: string | null;
  leaderName: string | null;
  allianceId: number | null;
  allianceName: string | null;
}

export interface TopTradersResponse {
  days: number;
  traders: TopTrader[];
  /** Accepted global trades in the window, and when the oldest trade we hold was posted. */
  tradesInWindow: number;
  oldestTradeAt: number | null;
}

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get("days") ?? DEFAULT_TRADER_WINDOW_DAYS);
  const days = (TRADER_WINDOWS_DAYS as readonly number[]).includes(requested) ? requested : DEFAULT_TRADER_WINDOW_DAYS;
  const since = Date.now() - days * DAY_MS;

  const ranked = rankTraders(queryTraderTotals(db, since));
  const stats = db.prepare(`
    SELECT (SELECT COUNT(*) FROM trades WHERE accepted = 1 AND type = 'GLOBAL' AND date_accepted >= ?) AS inWindow,
           (SELECT MIN(date) FROM trades) AS oldest
  `).get(since) as { inWindow: number; oldest: number | null };

  // The trades table only has ids; names come from the API, and a failure there just leaves the ids.
  const names = new Map<number, { nation_name: string; leader_name: string; alliance: { id: string; name: string } | null }>();
  if (ranked.length > 0) {
    try {
      const data = await gql<{ nations: { data: Array<{ id: string; nation_name: string; leader_name: string; alliance: { id: string; name: string } | null }> } }>(
        NAMES_QUERY, { id: ranked.map((t) => t.nationId) },
      );
      for (const nation of data.nations.data) names.set(Number(nation.id), nation);
    } catch (error) {
      console.error("[Top Traders] Could not load nation names:", error);
    }
  }

  const response: TopTradersResponse = {
    days,
    traders: ranked.map((trader) => {
      const nation = names.get(trader.nationId);
      return {
        ...trader,
        nationName: nation?.nation_name ?? null,
        leaderName: nation?.leader_name ?? null,
        allianceId: nation?.alliance ? Number(nation.alliance.id) : null,
        allianceName: nation?.alliance?.name ?? null,
      };
    }),
    tradesInWindow: stats.inWindow,
    oldestTradeAt: stats.oldest,
  };
  return NextResponse.json(response);
}
