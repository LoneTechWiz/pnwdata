export const LINK_TREATY_TYPES = ["Extension", "Offshore"] as const;

/** Members of an alliance: everyone except applicants. Vacation mode nations count. */
export function countMembers(nations: Array<{ alliance_position: string }>): number {
  return nations.filter((nation) => nation.alliance_position !== "APPLICANT").length;
}

export interface RawTreaty {
  treaty_type: string;
  approved: boolean;
  alliance1_id: string | number;
  alliance2_id: string | number;
}

export interface RawAlliance {
  id: string | number;
  name: string;
  acronym: string | null;
  score: number;
  rank: number;
  nation_count: number;
  treaties: RawTreaty[];
}

export interface GroupMember {
  id: number;
  name: string;
  acronym: string | null;
  score: number;
  nations: number;
  /** Treaty linking this alliance to the group, or null for the main alliance. */
  linkType: string | null;
}

export interface AllianceGroup {
  rank: number;
  mainId: number;
  mainName: string;
  mainAcronym: string | null;
  /** The main alliance's own in-game rank. */
  mainGameRank: number;
  totalScore: number;
  totalNations: number;
  members: GroupMember[];
}

/**
 * Groups alliances joined by approved Extension/Offshore treaties and ranks the groups by combined score.
 *
 * Treaty direction is not reliable, so each alliance attaches only to its single largest linked
 * partner by score (never to a smaller one). The largest alliance in a chain becomes the group's
 * main alliance. Attaching to one partner keeps a shared offshore from merging two big alliances.
 */
export function buildAllianceGroups(alliances: RawAlliance[], limit = 20): AllianceGroup[] {
  const byId = new Map(alliances.map((a) => [Number(a.id), a]));
  const linkTypes = new Set<string>(LINK_TREATY_TYPES);

  const links = new Map<number, Map<number, string>>();
  const addLink = (from: number, to: number, type: string) => {
    if (!links.has(from)) links.set(from, new Map());
    links.get(from)!.set(to, type);
  };
  for (const alliance of alliances) {
    for (const treaty of alliance.treaties ?? []) {
      if (!treaty.approved || !linkTypes.has(treaty.treaty_type)) continue;
      const a = Number(treaty.alliance1_id);
      const b = Number(treaty.alliance2_id);
      if (a === b || !byId.has(a) || !byId.has(b)) continue;
      addLink(a, b, treaty.treaty_type);
      addLink(b, a, treaty.treaty_type);
    }
  }

  // Ties on score break by id so the result is deterministic.
  const larger = (candidate: RawAlliance, than: RawAlliance) =>
    candidate.score > than.score || (candidate.score === than.score && Number(candidate.id) < Number(than.id));

  const parentOf = new Map<number, { id: number; type: string }>();
  for (const alliance of alliances) {
    const id = Number(alliance.id);
    let best: { id: number; type: string } | null = null;
    for (const [other, type] of links.get(id) ?? []) {
      const partner = byId.get(other)!;
      if (!larger(partner, alliance)) continue;
      if (!best || larger(partner, byId.get(best.id)!)) best = { id: other, type };
    }
    if (best) parentOf.set(id, best);
  }

  // Parents are always strictly larger, so following them cannot loop.
  const rootOf = (id: number): number => {
    let current = id;
    while (parentOf.has(current)) current = parentOf.get(current)!.id;
    return current;
  };

  const grouped = new Map<number, GroupMember[]>();
  for (const alliance of alliances) {
    const id = Number(alliance.id);
    const root = rootOf(id);
    const member: GroupMember = {
      id,
      name: alliance.name,
      acronym: alliance.acronym,
      score: alliance.score,
      nations: alliance.nation_count,
      linkType: id === root ? null : parentOf.get(id)!.type,
    };
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root)!.push(member);
  }

  return [...grouped.entries()]
    .map(([mainId, members]) => {
      const sorted = members.sort((a, b) => (a.id === mainId ? -1 : b.id === mainId ? 1 : b.score - a.score));
      const main = byId.get(mainId)!;
      return {
        rank: 0,
        mainId,
        mainName: main.name,
        mainAcronym: main.acronym,
        mainGameRank: main.rank,
        totalScore: sorted.reduce((sum, m) => sum + m.score, 0),
        totalNations: sorted.reduce((sum, m) => sum + m.nations, 0),
        members: sorted,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.mainId - b.mainId)
    .slice(0, limit)
    .map((group, index) => ({ ...group, rank: index + 1 }));
}
