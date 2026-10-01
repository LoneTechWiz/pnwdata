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

export function existingOfferUrl(trade: Trade): string {
  const url = new URL("https://politicsandwar.com/index.php");
  url.search = new URLSearchParams({
    id: "26", display: "nation", resource1: trade.offer_resource.toLowerCase(),
    buysell: trade.buy_or_sell, ob: "date", od: "DESC", maximum: "1000", minimum: "0", search: "Go",
  }).toString();
  return url.toString();
}

export function replacementPrice(trade: Trade, bestPrice: number): number {
  // Use whole-dollar suggestions and keep sell prices positive.
  return trade.buy_or_sell === "sell" ? Math.max(1, Math.ceil(bestPrice) - 1) : Math.floor(bestPrice) + 1;
}

export function replacementOfferUrl(trade: Trade, bestPrice: number): string {
  const url = new URL("https://politicsandwar.com/nation/trade/create/");
  url.search = new URLSearchParams({
    resource: trade.offer_resource.toLowerCase(), p: String(replacementPrice(trade, bestPrice)),
    q: String(trade.offer_amount), t: trade.buy_or_sell === "sell" ? "s" : "b",
  }).toString();
  return url.toString();
}
