import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("./db", () => ({ default: new Database(":memory:") }));

import { TRADE_RETENTION_DAYS, parseGameDate, pruneTrades, storeTrades, syncTrades, type GqlFn, type RawTrade } from "./trade-sync";

const SCHEMA = `
  CREATE TABLE trades (
    id INTEGER PRIMARY KEY, type TEXT, date INTEGER NOT NULL, sender_id INTEGER, receiver_id INTEGER,
    offer_resource TEXT, offer_amount INTEGER, buy_or_sell TEXT, price INTEGER,
    accepted INTEGER NOT NULL DEFAULT 0, date_accepted INTEGER, original_trade_id INTEGER
  );
`;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

let database: Database.Database;
beforeEach(() => {
  database = new Database(":memory:");
  database.exec(SCHEMA);
});

function trade(id: number, overrides: Partial<RawTrade> = {}): RawTrade {
  return {
    id: String(id), type: "GLOBAL", date: "2026-10-29 10:00:00", sender_id: "11", receiver_id: "0",
    offer_resource: "steel", offer_amount: 500, buy_or_sell: "sell", price: 3700, accepted: false,
    date_accepted: null, original_trade_id: null, ...overrides,
  };
}

/** A fake API where `all` is every trade the game has, filtered the way the sync's queries ask. */
function fakeApi(all: RawTrade[], firstSince = all[0]?.id) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const gql: GqlFn = async <T,>(query: string, variables: Record<string, unknown> = {}) => {
    calls.push({ query, variables });
    let data: unknown[];
    if (query.includes("after:$after")) data = firstSince === undefined ? [] : [{ id: firstSince }];
    else if (query.includes("accepted:true")) data = all.filter((t) => t.accepted).slice(-1000).reverse();
    else data = all.filter((t) => Number(t.id) >= (variables.min_id as number)).slice(0, variables.first as number);
    return { trades: { data } } as T;
  };
  return { gql, calls };
}

describe("parseGameDate", () => {
  it("reads the game's timestamps as UTC and treats zero dates as missing", () => {
    expect(parseGameDate("2026-10-29 10:00:00")).toBe(Date.UTC(2026, 9, 29, 10, 0, 0));
    expect(parseGameDate("2026-10-29T10:00:00+00:00")).toBe(Date.UTC(2026, 9, 29, 10, 0, 0));
    expect(parseGameDate("0000-00-00 00:00:00")).toBeNull();
    expect(parseGameDate(null)).toBeNull();
    expect(parseGameDate("nonsense")).toBeNull();
  });
});

describe("storeTrades", () => {
  it("stores real columns and updates an offer in place when it is accepted", () => {
    storeTrades(database, [trade(5)]);
    storeTrades(database, [trade(5, { accepted: true, receiver_id: "22", date_accepted: "2026-10-29 11:30:00" })]);
    expect(database.prepare("SELECT * FROM trades").all()).toEqual([{
      id: 5, type: "GLOBAL", date: Date.UTC(2026, 9, 29, 10), sender_id: 11, receiver_id: 22, offer_resource: "steel",
      offer_amount: 500, buy_or_sell: "sell", price: 3700, accepted: 1, date_accepted: Date.UTC(2026, 9, 29, 11, 30), original_trade_id: null,
    }]);
  });

  it("keeps the original trade id and skips rows with no usable id or date", () => {
    const stored = storeTrades(database, [trade(7, { original_trade_id: "6" }), trade(0), trade(8, { date: null })]);
    expect(stored).toBe(1);
    expect(database.prepare("SELECT id, original_trade_id FROM trades").all()).toEqual([{ id: 7, original_trade_id: 6 }]);
  });
});

describe("pruneTrades", () => {
  it("drops trades posted more than 365 days ago", () => {
    storeTrades(database, [
      trade(1, { date: new Date(NOW - (TRADE_RETENTION_DAYS + 1) * DAY).toISOString().slice(0, 19).replace("T", " ") }),
      trade(2, { date: new Date(NOW - (TRADE_RETENTION_DAYS - 1) * DAY).toISOString().slice(0, 19).replace("T", " ") }),
    ]);
    expect(pruneTrades(database, NOW)).toBe(1);
    expect(database.prepare("SELECT id FROM trades").all()).toEqual([{ id: 2 }]);
  });
});

describe("syncTrades", () => {
  it("starts at the oldest trade in the window on the first run, then continues from the highest id", async () => {
    const all = Array.from({ length: 5 }, (_, i) => trade(100 + i));
    const first = fakeApi(all);
    await syncTrades(first.gql, database, NOW);
    expect(first.calls[0].variables.after).toBe(new Date(NOW - 365 * DAY).toISOString().slice(0, 19).replace("T", " "));
    expect(first.calls[1].variables).toEqual({ min_id: 100, first: 1000 });
    expect(database.prepare("SELECT COUNT(*) AS n FROM trades").get()).toEqual({ n: 5 });

    all.push(trade(105), trade(106));
    const second = fakeApi(all);
    await syncTrades(second.gql, database, NOW);
    expect(second.calls[0].variables).toEqual({ min_id: 105, first: 1000 });
    expect(database.prepare("SELECT MAX(id) AS id FROM trades").get()).toEqual({ id: 106 });
  });

  it("can be capped to a few pages per run, and the next run carries on without skipping any ids", async () => {
    const all = Array.from({ length: 4500 }, (_, i) => trade(1 + i));
    const api = fakeApi(all);
    await syncTrades(api.gql, database, NOW, 3);
    expect(database.prepare("SELECT COUNT(*) AS n FROM trades").get()).toEqual({ n: 3000 });
    await syncTrades(api.gql, database, NOW, 3);
    expect(database.prepare("SELECT COUNT(*) AS n, MAX(id) AS top FROM trades").get()).toEqual({ n: 4500, top: 4500 });
  });

  it("does not let recently accepted trades beyond an unfinished backfill create a gap", async () => {
    const all = Array.from({ length: 4000 }, (_, i) => trade(1 + i));
    all[3999] = trade(4000, { accepted: true, date_accepted: "2026-10-30 11:00:00" });
    const api = fakeApi(all);
    await syncTrades(api.gql, database, NOW, 3);
    expect(database.prepare("SELECT MAX(id) AS id FROM trades").get()).toEqual({ id: 3000 });
    await syncTrades(api.gql, database, NOW, 3);
    expect(database.prepare("SELECT COUNT(*) AS n FROM trades").get()).toEqual({ n: 4000 });
  });

  it("picks up an old offer that was accepted in place", async () => {
    const all = [trade(1), trade(2)];
    await syncTrades(fakeApi(all).gql, database, NOW);
    all[0] = trade(1, { accepted: true, receiver_id: "9", date_accepted: "2026-10-30 09:00:00" });
    await syncTrades(fakeApi(all).gql, database, NOW);
    expect(database.prepare("SELECT accepted, receiver_id FROM trades WHERE id = 1").get()).toEqual({ accepted: 1, receiver_id: 9 });
  });

  it("catches up on a long history in a single run by default", async () => {
    const api = fakeApi(Array.from({ length: 7500 }, (_, i) => trade(1 + i)));
    await syncTrades(api.gql, database, NOW);
    expect(database.prepare("SELECT COUNT(*) AS n FROM trades").get()).toEqual({ n: 7500 });
  });

  it("does nothing when the game has no trades in the window", async () => {
    await syncTrades(fakeApi([], undefined).gql, database, NOW);
    expect(database.prepare("SELECT COUNT(*) AS n FROM trades").get()).toEqual({ n: 0 });
  });
});
