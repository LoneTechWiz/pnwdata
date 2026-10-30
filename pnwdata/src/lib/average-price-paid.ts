import type { Database } from "better-sqlite3";

/** What can be traded on the market. */
export const TRADEABLE_RESOURCES = [
  "coal", "oil", "uranium", "iron", "bauxite", "lead", "gasoline", "munitions", "steel", "aluminum", "food", "credits",
] as const;

export const MAX_AMOUNT = 1e12;

export interface AveragePricePaid {
  nationId: number;
  resource: string;
  /** The amount asked about. */
  amount: number;
  /** Weighted average price per unit over the units covered, to the cent; null when the nation has no purchases on record. */
  averagePrice: number | null;
  totalCost: number;
  /** How many of the `amount` units could be matched to purchases we hold. */
  unitsCovered: number;
  /** False when the nation's recorded purchases (kept for a year) don't add up to `amount`. */
  complete: boolean;
  trades: number;
  /** Acceptance times (Unix ms) of the newest and oldest purchase used. */
  newestPurchaseAt: number | null;
  oldestPurchaseAt: number | null;
}

/**
 * The average price per unit a nation paid for `amount` of a resource, assuming what it holds came from
 * its most recent purchases: accepted global buys are taken newest first until `amount` units are covered
 * (the last trade only partly, if it overshoots). If the nation bought less than `amount`, the average is
 * over everything it bought and `complete` is false.
 */
export function averagePricePaid(database: Database, nationId: number, resource: string, amount: number): AveragePricePaid {
  const purchases = database.prepare(`
    SELECT t.offer_amount AS units, t.price AS price, t.date_accepted AS acceptedAt
    FROM trades t
    WHERE ((LOWER(t.buy_or_sell) = 'sell' AND t.receiver_id = @nationId) OR (LOWER(t.buy_or_sell) = 'buy' AND t.sender_id = @nationId))
      AND t.offer_resource = @resource
      AND t.accepted = 1 AND t.type = 'GLOBAL' AND t.price IS NOT NULL AND t.offer_amount > 0 AND t.date_accepted IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM trades c WHERE c.original_trade_id = t.id AND c.accepted = 1)
    ORDER BY t.date_accepted DESC, t.id DESC
  `).iterate({ nationId, resource }) as IterableIterator<{ units: number; price: number; acceptedAt: number }>;

  let covered = 0;
  let cost = 0;
  let trades = 0;
  let newest: number | null = null;
  let oldest: number | null = null;
  for (const purchase of purchases) {
    const units = Math.min(purchase.units, amount - covered);
    covered += units;
    cost += units * purchase.price;
    trades++;
    newest ??= purchase.acceptedAt;
    oldest = purchase.acceptedAt;
    if (covered >= amount) break;
  }

  return {
    nationId,
    resource,
    amount,
    averagePrice: covered > 0 ? Math.round((cost / covered) * 100) / 100 : null,
    totalCost: Math.round(cost * 100) / 100,
    unitsCovered: covered,
    complete: covered >= amount,
    trades,
    newestPurchaseAt: newest,
    oldestPurchaseAt: oldest,
  };
}
