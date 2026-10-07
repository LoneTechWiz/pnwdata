import { describe, expect, it } from "vitest";
import { buildAllianceGroups, countMembers, type RawAlliance } from "./alliance-rankings";

function alliance(id: number, score: number, treaties: RawAlliance["treaties"] = [], nations = 10): RawAlliance {
  return { id, name: `A${id}`, acronym: null, score, rank: 0, nation_count: nations, treaties };
}
const treaty = (type: string, a: number, b: number, approved = true) => ({
  treaty_type: type, approved, alliance1_id: a, alliance2_id: b,
});

describe("buildAllianceGroups", () => {
  it("combines an extension and an offshore into the main alliance, whichever way the treaty points", () => {
    const groups = buildAllianceGroups([
      alliance(1, 1000, [treaty("Extension", 1, 2)]),
      alliance(2, 100, [treaty("Extension", 1, 2)]),
      alliance(3, 50, [treaty("Offshore", 3, 1)]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].mainId).toBe(1);
    expect(groups[0].totalScore).toBe(1150);
    expect(groups[0].totalNations).toBe(30);
    expect(groups[0].members.map((m) => [m.id, m.linkType])).toEqual([[1, null], [2, "Extension"], [3, "Offshore"]]);
  });

  it("ignores other treaty types and unapproved treaties", () => {
    const groups = buildAllianceGroups([
      alliance(1, 1000, [treaty("MDP", 1, 2), treaty("Extension", 1, 3, false)]),
      alliance(2, 100),
      alliance(3, 50),
    ]);
    expect(groups.map((g) => g.members.length)).toEqual([1, 1, 1]);
  });

  it("does not merge two big alliances through a shared offshore", () => {
    const groups = buildAllianceGroups([
      alliance(1, 1000, [treaty("Extension", 1, 3)]),
      alliance(2, 900, [treaty("Offshore", 2, 3)]),
      alliance(3, 10),
    ]);
    expect(groups.map((g) => [g.mainId, g.members.length])).toEqual([[1, 2], [2, 1]]);
  });

  it("follows a chain up to its largest alliance", () => {
    const groups = buildAllianceGroups([
      alliance(1, 1000, [treaty("Extension", 1, 2)]),
      alliance(2, 100, [treaty("Offshore", 2, 3)]),
      alliance(3, 5),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].mainId).toBe(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it("ignores treaties with alliances that are not in the list", () => {
    const groups = buildAllianceGroups([alliance(1, 100, [treaty("Extension", 1, 99)])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(1);
  });

  it("ranks by combined score and limits the result", () => {
    const groups = buildAllianceGroups(
      [alliance(1, 500), alliance(2, 300, [treaty("Extension", 2, 3)]), alliance(3, 250), alliance(4, 100)],
      2,
    );
    expect(groups.map((g) => [g.rank, g.mainId, g.totalScore])).toEqual([[1, 2, 550], [2, 1, 500]]);
  });
});

describe("countMembers", () => {
  it("excludes applicants but keeps every other position", () => {
    const nations = [
      { alliance_position: "APPLICANT" },
      { alliance_position: "APPLICANT" },
      { alliance_position: "MEMBER" },
      { alliance_position: "LEADER" },
      { alliance_position: "HEIR" },
    ];
    expect(countMembers(nations)).toBe(3);
  });
});
