import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { averagePricePaid } from "./average-price-paid";

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
function buy(t: { side?: "buy" | "sell"; buyer?: number; resource?: string; units: number; price: number; at: number; type?: string; accepted?: boolean; id?: number; original?: number }) {
  database.prepare(`
    INSERT INTO trades (id, type, date, sender_id, receiver_id, offer_resource, offer_amount, buy_or_sell, price, accepted, date_accepted, original_trade_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(t.id ?? nextId++, t.type ?? "GLOBAL", t.at, ...(t.side === "buy" ? [t.buyer ?? 1, 99] : [99, t.buyer ?? 1]), t.resource ?? "steel", t.units, t.side ?? "sell", t.price,
    t.accepted === false ? 0 : 1, t.accepted === false ? null : t.at, t.original ?? null);
}

describe("averagePricePaid", () => {
  it("weights the average by units across the most recent purchases", () => {
    buy({ units: 100, price: 3000, at: 1000 });
    buy({ units: 300, price: 3400, at: 2000 });
    const result = averagePricePaid(database, 1, "steel", 400);
    expect(result).toMatchObject({ averagePrice: 3300, totalCost: 1_320_000, unitsCovered: 400, complete: true, trades: 2, newestPurchaseAt: 2000, oldestPurchaseAt: 1000 });
  });

  it("uses newest purchases first and pro-rates the last one to cover exactly the amount", () => {
    buy({ units: 1000, price: 2000, at: 1000 });
    buy({ units: 100, price: 4000, at: 2000 });
    const result = averagePricePaid(database, 1, "steel", 150);
    // 100 units at 4000 plus 50 of the 1000 at 2000.
    expect(result.totalCost).toBe(500_000);
    expect(result.averagePrice).toBe(3333.33);
    expect(result.trades).toBe(2);
  });

  it("reports an incomplete answer when the nation bought less than asked", () => {
    buy({ units: 100, price: 3000, at: 1000 });
    expect(averagePricePaid(database, 1, "steel", 500)).toMatchObject({ averagePrice: 3000, unitsCovered: 100, complete: false });
  });

  it("counts a buy offer the nation sent as its purchase, and a sell offer it sent as not one", () => {
    buy({ side: "buy", units: 100, price: 3000, at: 1000 });
    expect(averagePricePaid(database, 1, "steel", 100)).toMatchObject({ averagePrice: 3000, trades: 1 });
    database.exec("UPDATE trades SET buy_or_sell = 'sell', sender_id = 1, receiver_id = 99");
    expect(averagePricePaid(database, 1, "steel", 100).trades).toBe(0);
  });

  it("returns a null average when there are no purchases", () => {
    expect(averagePricePaid(database, 1, "steel", 500)).toMatchObject({ averagePrice: null, unitsCovered: 0, complete: false, trades: 0, newestPurchaseAt: null });
  });

  it("only counts this nation's accepted global buys of this resource", () => {
    buy({ buyer: 2, units: 100, price: 1, at: 1000 });
    buy({ resource: "coal", units: 100, price: 1, at: 1000 });
    buy({ type: "PERSONAL", units: 100, price: 1, at: 1000 });
    buy({ accepted: false, units: 100, price: 1, at: 1000 });
    buy({ units: 100, price: 3000, at: 1000 });
    expect(averagePricePaid(database, 1, "steel", 100)).toMatchObject({ averagePrice: 3000, trades: 1 });
  });

  it("doesn't count a trade twice when the original offer row is kept alongside its accepted copy", () => {
    buy({ id: 50, units: 100, price: 3000, at: 1000 });
    buy({ id: 51, units: 100, price: 3000, at: 1000, original: 50 });
    expect(averagePricePaid(database, 1, "steel", 500)).toMatchObject({ unitsCovered: 100, trades: 1 });
  });
});
