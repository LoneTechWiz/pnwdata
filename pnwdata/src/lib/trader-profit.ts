import type { Database } from "better-sqlite3";

export const TRADER_WINDOWS_DAYS = [1, 7, 30, 90, 365] as const;
export const DEFAULT_TRADER_WINDOW_DAYS = 30;
export const TOP_TRADERS = 100;

/** One nation's accepted market buying and selling of one resource over a window. */
export interface TraderResourceTotals {
  nationId: number;
  resource: string;
  unitsBought: number;
  costOfBought: number;
  unitsSold: number;
  revenueOfSold: number;
  trades: number;
}

export interface TraderProfit {
  nationId: number;
  /** Profit on the units that were both bought and sold, summed over resources. */
  profit: number;
  /** Money out on buys and in from sells, across all units (producers and consumers show up here, not in `profit`). */
  netCashFlow: number;
  tradedValue: number;
  trades: number;
  /** The resource that earned the most. */
  bestResource: string | null;
}

/**
 * Totals per nation and resource of accepted global trades since `since` (Unix ms, by acceptance time).
 * `buy_or_sell` is the sender's side: on a "sell" the sender is the seller and the receiver the buyer, on a
 * "buy" the sender is the buyer and the receiver the seller. A trade whose id is the `original_trade_id`
 * of another accepted trade is the offer that one was made from, so only the accepted copy counts.
 */
export function queryTraderTotals(database: Database, since: number): TraderResourceTotals[] {
  return database.prepare(`
    WITH accepted AS (
      SELECT t.* FROM trades t
      WHERE t.accepted = 1 AND t.type = 'GLOBAL' AND t.date_accepted >= @since
        AND t.sender_id IS NOT NULL AND t.receiver_id IS NOT NULL AND t.price IS NOT NULL AND t.offer_amount IS NOT NULL
        AND LOWER(t.buy_or_sell) IN ('buy', 'sell')
        AND NOT EXISTS (SELECT 1 FROM trades c WHERE c.original_trade_id = t.id AND c.accepted = 1)
    ), sides AS (
      SELECT sender_id AS nation_id, offer_resource, LOWER(buy_or_sell) = 'buy' AS bought, offer_amount AS units, offer_amount * CAST(price AS REAL) AS value FROM accepted
      UNION ALL
      SELECT receiver_id, offer_resource, LOWER(buy_or_sell) = 'sell', offer_amount, offer_amount * CAST(price AS REAL) FROM accepted
    )
    SELECT nation_id AS nationId, offer_resource AS resource,
      SUM(CASE WHEN bought = 1 THEN units ELSE 0 END) AS unitsBought,
      SUM(CASE WHEN bought = 1 THEN value ELSE 0 END) AS costOfBought,
      SUM(CASE WHEN bought = 0 THEN units ELSE 0 END) AS unitsSold,
      SUM(CASE WHEN bought = 0 THEN value ELSE 0 END) AS revenueOfSold,
      COUNT(*) AS trades
    FROM sides
    WHERE nation_id > 0 AND offer_resource IS NOT NULL
    GROUP BY nation_id, offer_resource
  `).all({ since }) as TraderResourceTotals[];
}

/**
 * Ranks nations by trading profit: for each resource, the units a nation both bought and sold in the
 * window, times the gap between its average sell price and average buy price. Units only bought (consumed)
 * or only sold (produced) have no matching side, so they don't count as trading profit.
 */
export function rankTraders(totals: TraderResourceTotals[], limit = TOP_TRADERS): TraderProfit[] {
  const byNation = new Map<number, TraderProfit & { bestProfit: number }>();
  for (const row of totals) {
    const entry = byNation.get(row.nationId)
      ?? { nationId: row.nationId, profit: 0, netCashFlow: 0, tradedValue: 0, trades: 0, bestResource: null, bestProfit: 0 };
    const matched = Math.min(row.unitsBought, row.unitsSold);
    const profit = matched > 0 ? matched * (row.revenueOfSold / row.unitsSold - row.costOfBought / row.unitsBought) : 0;
    entry.profit += profit;
    entry.netCashFlow += row.revenueOfSold - row.costOfBought;
    entry.tradedValue += row.revenueOfSold + row.costOfBought;
    entry.trades += row.trades;
    if (profit > entry.bestProfit) {
      entry.bestProfit = profit;
      entry.bestResource = row.resource;
    }
    byNation.set(row.nationId, entry);
  }
  return [...byNation.values()]
    .filter((trader) => trader.profit > 0)
    .sort((a, b) => b.profit - a.profit || a.nationId - b.nationId)
    .slice(0, limit)
    .map((trader) => ({
      nationId: trader.nationId, profit: trader.profit, netCashFlow: trader.netCashFlow,
      tradedValue: trader.tradedValue, trades: trader.trades, bestResource: trader.bestResource,
    }));
}
