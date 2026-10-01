import { describe, expect, it } from "vitest";
import { fetchRaidRequesterContext } from "./raid-requester";

describe("fetchRaidRequesterContext", () => {
  it("loads any nation and its active wars from P&W", async () => {
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        variables: { nationId: number[] };
      };
      expect(request.variables.nationId).toEqual([12345]);
      return new Response(JSON.stringify({
        data: {
          nations: {
            data: [{
              id: 12345,
              nation_name: "External Nation",
              leader_name: "External Leader",
              score: 2222.5,
              alliance_id: 99,
            }],
          },
          wars: { data: [{ att_id: 12345, def_id: 67890 }] },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    await expect(fetchRaidRequesterContext(12345, { apiKey: "test", fetcher }))
      .resolves.toEqual({
        nation: {
          id: 12345,
          nation_name: "External Nation",
          leader_name: "External Leader",
          score: 2222.5,
          alliance_id: 99,
        },
        activeWars: [{ att_id: 12345, def_id: 67890 }],
      });
  });

  it("returns a missing nation without treating it as an API failure", async () => {
    const fetcher = async () => new Response(JSON.stringify({
      data: { nations: { data: [] }, wars: { data: [] } },
    }), { status: 200 });

    await expect(fetchRaidRequesterContext(999999999, { apiKey: "test", fetcher }))
      .resolves.toEqual({ nation: null, activeWars: [] });
  });

  it("reports GraphQL failures", async () => {
    const fetcher = async () => new Response(JSON.stringify({
      errors: [{ message: "invalid request" }],
    }), { status: 200 });

    await expect(fetchRaidRequesterContext(12345, { apiKey: "test", fetcher }))
      .rejects.toThrow("invalid request");
  });
});
