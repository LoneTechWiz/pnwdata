import type { Database } from "better-sqlite3";
import db from "./db";

/** The sync's API client (`gql` in sync.ts), injected so this module doesn't import sync.ts. */
export type GqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

export const TRADE_RETENTION_DAYS = 365;
const PAGE_SIZE = 1000;
/**
 * Most pages of new trades fetched per sync. Normal runs need one page and stop at the first short one;
 * the cap only bounds how long a single sync can run while the first run catches up on history.
 */
const MAX_PAGES_PER_RUN = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

const TRADE_FIELDS = "id type date sender_id receiver_id offer_resource offer_amount buy_or_sell price accepted date_accepted original_trade_id";

const NEW_TRADES_QUERY = `
  query($min_id:Int, $first:Int) {
    trades(min_id:$min_id, first:$first, orderBy:[{column:ID, order:ASC}]) { data { ${TRADE_FIELDS} } }
  }
`;

const FIRST_TRADE_SINCE_QUERY = `
  query($after:DateTime) {
    trades(after:$after, first:1, orderBy:[{column:ID, order:ASC}]) { data { id } }
  }
`;

const RECENTLY_ACCEPTED_QUERY = `
  query($first:Int) {
    trades(accepted:true, first:$first, orderBy:[{column:DATE_ACCEPTED, order:DESC}]) { data { ${TRADE_FIELDS} } }
  }
`;

export interface RawTrade {
  id: string | number;
  type: string | null;
  date: string | null;
  sender_id: string | number | null;
  receiver_id: string | number | null;
  offer_resource: string | null;
  offer_amount: number | null;
  buy_or_sell: string | null;
  price: number | null;
  accepted: boolean | null;
  date_accepted: string | null;
  original_trade_id: string | number | null;
}

/** The game's `YYYY-MM-DD HH:MM:SS` timestamps are UTC; anything with an explicit zone is parsed as given. */
export function parseGameDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  const ms = plain
    ? Date.UTC(+plain[1], +plain[2] - 1, +plain[3], +plain[4], +plain[5], +plain[6])
    : Date.parse(value);
  // The game uses 0000-00-00 for "never".
  return Number.isNaN(ms) || ms <= 0 ? null : ms;
}

const idOrNull = (value: string | number | null | undefined): number | null => {
  const n = Number(value);
  return value != null && Number.isSafeInteger(n) && n > 0 ? n : null;
};

const UPSERT_TRADE = `
  INSERT INTO trades
    (id, type, date, sender_id, receiver_id, offer_resource, offer_amount, buy_or_sell, price, accepted, date_accepted, original_trade_id)
  VALUES
    (@id, @type, @date, @sender_id, @receiver_id, @offer_resource, @offer_amount, @buy_or_sell, @price, @accepted, @date_accepted, @original_trade_id)
  ON CONFLICT(id) DO UPDATE SET
    type = excluded.type, date = excluded.date, sender_id = excluded.sender_id, receiver_id = excluded.receiver_id,
    offer_resource = excluded.offer_resource, offer_amount = excluded.offer_amount, buy_or_sell = excluded.buy_or_sell,
    price = excluded.price, accepted = excluded.accepted, date_accepted = excluded.date_accepted,
    original_trade_id = excluded.original_trade_id
`;

/** Inserts or updates trades by id. Rows without a usable id or posting date are skipped. Returns how many were stored. */
export function storeTrades(database: Database, trades: RawTrade[]): number {
  const upsert = database.prepare(UPSERT_TRADE);
  let stored = 0;
  database.transaction(() => {
    for (const trade of trades) {
      const id = idOrNull(trade.id);
      const date = parseGameDate(trade.date);
      if (id === null || date === null) continue;
      upsert.run({
        id,
        type: trade.type,
        date,
        sender_id: idOrNull(trade.sender_id),
        receiver_id: idOrNull(trade.receiver_id),
        offer_resource: trade.offer_resource,
        offer_amount: trade.offer_amount,
        buy_or_sell: trade.buy_or_sell,
        price: trade.price,
        accepted: trade.accepted ? 1 : 0,
        date_accepted: parseGameDate(trade.date_accepted),
        original_trade_id: idOrNull(trade.original_trade_id),
      });
      stored++;
    }
  })();
  return stored;
}

export function pruneTrades(database: Database, now: number): number {
  return database.prepare("DELETE FROM trades WHERE date < ?").run(now - TRADE_RETENTION_DAYS * DAY_MS).changes;
}

/**
 * Pulls the game's trades and offers (every type) into the `trades` table and drops anything older
 * than a year. New rows are walked by id from the highest one stored; on the very first run that
 * starts at the oldest trade inside the retention window and pages until it reaches the present.
 * Recently accepted trades are re-read too, in case the game updates an offer in place on acceptance.
 */
export async function syncTrades(gql: GqlFn, database: Database = db, now = Date.now(), maxPages = MAX_PAGES_PER_RUN): Promise<void> {
  let cursor = (database.prepare("SELECT MAX(id) AS id FROM trades").get() as { id: number | null }).id;
  if (cursor === null) {
    const after = new Date(now - TRADE_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 19).replace("T", " ");
    const first = await gql<{ trades: { data: Array<{ id: string }> } }>(FIRST_TRADE_SINCE_QUERY, { after });
    const firstId = idOrNull(first.trades.data[0]?.id);
    if (firstId === null) return;
    cursor = firstId - 1;
  }

  let fetched = 0;
  for (let page = 0; page < maxPages; page++) {
    const { trades } = await gql<{ trades: { data: RawTrade[] } }>(NEW_TRADES_QUERY, { min_id: cursor + 1, first: PAGE_SIZE });
    if (trades.data.length === 0) break;
    storeTrades(database, trades.data);
    fetched += trades.data.length;
    cursor = Math.max(cursor, ...trades.data.map((trade) => idOrNull(trade.id) ?? 0));
    if (trades.data.length < PAGE_SIZE) break;
  }

  // Rows past the cursor are left for the id walk, so an unfinished backfill never skips a gap.
  const { trades: accepted } = await gql<{ trades: { data: RawTrade[] } }>(RECENTLY_ACCEPTED_QUERY, { first: PAGE_SIZE });
  const caughtUp = cursor;
  storeTrades(database, accepted.data.filter((trade) => (idOrNull(trade.id) ?? Infinity) <= caughtUp));

  const pruned = pruneTrades(database, now);
  console.log(`[Trade Sync] ${fetched} new trades, ${pruned} past ${TRADE_RETENTION_DAYS} days removed`);
}
