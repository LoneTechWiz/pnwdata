import { config } from "./config.js";
import type { Trade } from "./types.js";

const endpoint = `https://api.politicsandwar.com/graphql?api_key=${encodeURIComponent(config.pnwApiKey)}`;

type ApiTrade = Omit<Trade, "id" | "sid" | "rid"> & { id: string | number; sid: string | number; rid: string | number };

/** Fetches all currently open global offers used to determine market leaders. */
export async function getOpenGlobalTrades(): Promise<Trade[]> {
  const query = `
    query OpenGlobalTrades {
      trades(first: 1000, type: GLOBAL, accepted: false) {
        data { id buy_or_sell offer_amount offer_resource total sid rid }
      }
    }
  `;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`P&W API request failed (${response.status}).`);

  const payload = (await response.json()) as {
    data?: { trades?: { data?: ApiTrade[] } };
    errors?: { message: string }[];
  };
  if (payload.errors?.length) throw new Error(`P&W API: ${payload.errors.map((e) => e.message).join("; ")}`);

  return (payload.data?.trades?.data ?? [])
    .filter((trade) => trade.offer_amount > 0 && trade.total >= 0 && (trade.buy_or_sell === "buy" || trade.buy_or_sell === "sell"))
    .map((trade) => ({ ...trade, id: String(trade.id), sid: String(trade.sid), rid: String(trade.rid) }));
}

export function marketUrl(resource: string): string {
  return `https://politicsandwar.com/index.php?id=26&resource1=${encodeURIComponent(resource.toLowerCase())}`;
}
