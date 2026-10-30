import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { queryTraderTotals, rankTraders, type TraderResourceTotals } from "./trader-profit";

const NOW = Date.UTC(2026, 9, 30, 12);
const DAY = 24 * 60 * 60 * 1000;

let database: Database.Database;
beforeEach(() => {
  database = new Database(":memory:");
  database.exec(`
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY, type TEXT, date INTEGER NOT NULL, sender_id INTEGER, receiver_id INTEGER,
      offer_resource TEXT, offer_amount INTEGER, buy_or_sell TEXT, price INTEGER,
      accepted INTEGER NOT NULL DEFAULT 0, date_accepted INTEGER, original_trade_id INTEGER
    );
  `);
});

let nextId = 1;
function addTrade(t: { seller: number; buyer: number; resource?: string; amount: number; price: number; type?: string; accepted?: boolean; acceptedAt?: number; original?: number; id?: number }) {
  database.prepare(`
    INSERT INTO trades (id, type, date, sender_id, receiver_id, offer_resource, offer_amount, buy_or_sell, price, accepted, date_accepted, original_trade_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'sell', ?, ?, ?, ?)
  `).run(t.id ?? nextId++, t.type ?? "GLOBAL", NOW - DAY, t.seller, t.buyer, t.resource ?? "steel", t.amount, t.price,
    t.accepted === false ? 0 : 1, t.accepted === false ? null : (t.acceptedAt ?? NOW - 1000), t.original ?? null);
}

describe("queryTraderTotals", () => {
  it("totals what each nation bought and sold per resource", () => {
    addTrade({ seller: 1, buyer: 2, amount: 100, price: 3000 });
    addTrade({ seller: 2, buyer: 3, amount: 100, price: 3500 });
    const totals = queryTraderTotals(database, NOW - DAY);
    const nation2 = totals.find((t) => t.nationId === 2)!;
    expect(nation2).toMatchObject({ resource: "steel", unitsBought: 100, costOfBought: 300_000, unitsSold: 100, revenueOfSold: 350_000, trades: 2 });
  });

  it("ignores open offers, non-global trades, and trades accepted before the window", () => {
    addTrade({ seller: 1, buyer: 2, amount: 100, price: 3000, accepted: false });
    addTrade({ seller: 1, buyer: 2, amount: 100, price: 3000, type: "PERSONAL" });
    addTrade({ seller: 1, buyer: 2, amount: 100, price: 3000, acceptedAt: NOW - 5 * DAY });
    expect(queryTraderTotals(database, NOW - DAY)).toEqual([]);
  });

  it("doesn't count a trade twice when the game keeps the original offer row as well as the accepted copy", () => {
    addTrade({ id: 10, seller: 1, buyer: 2, amount: 100, price: 3000 });
    addTrade({ id: 11, seller: 1, buyer: 2, amount: 100, price: 3000, original: 10 });
    const seller = queryTraderTotals(database, NOW - DAY).find((t) => t.nationId === 1)!;
    expect(seller.unitsSold).toBe(100);
    expect(seller.trades).toBe(1);
  });
});

const row = (nationId: number, resource: string, bought: [number, number], sold: [number, number]): TraderResourceTotals => ({
  nationId, resource, unitsBought: bought[0], costOfBought: bought[0] * bought[1], unitsSold: sold[0], revenueOfSold: sold[0] * sold[1], trades: 2,
});

describe("rankTraders", () => {
  it("profits only on matched units at the average price gap", () => {
    // Bought 1000 at 3000, sold 400 at 3500: only the 400 sold have a matching buy.
    const [trader] = rankTraders([row(1, "steel", [1000, 3000], [400, 3500])]);
    expect(trader.profit).toBe(400 * 500);
    expect(trader.netCashFlow).toBe(400 * 3500 - 1000 * 3000);
  });

  it("does not rank pure producers or consumers", () => {
    expect(rankTraders([row(1, "steel", [0, 0], [500, 3500]), row(2, "steel", [500, 3500], [0, 0])])).toEqual([]);
  });

  it("drops traders who lost money, sums resources, names the best one, and orders by profit", () => {
    const ranked = rankTraders([
      row(1, "steel", [100, 3000], [100, 3300]),
      row(1, "coal", [100, 4000], [100, 4100]),
      row(2, "steel", [100, 3000], [100, 3700]),
      row(3, "steel", [100, 3000], [100, 2900]),
    ]);
    expect(ranked.map((t) => [t.nationId, t.profit, t.bestResource])).toEqual([[2, 70_000, "steel"], [1, 40_000, "steel"]]);
  });

  it("keeps only the top N", () => {
    const totals = Array.from({ length: 5 }, (_, i) => row(i + 1, "steel", [10, 3000], [10, 3100 + i]));
    expect(rankTraders(totals, 3).map((t) => t.nationId)).toEqual([5, 4, 3]);
  });
});
