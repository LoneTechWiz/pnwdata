import { gql } from "./sync";
import { countMembers, type RawAlliance } from "./alliance-rankings";

const CACHE_MS = 10 * 60 * 1000;

const ALLIANCES_QUERY = `
  query($page:Int) { alliances(first:100, page:$page, orderBy:[{column:SCORE, order:DESC}, {column:ID, order:ASC}]) {
    paginatorInfo { hasMorePages total }
    data { id name acronym score rank nations { alliance_position } treaties { treaty_type approved alliance1_id alliance2_id } }
  } }
`;

interface AlliancesPage {
  alliances: {
    paginatorInfo: { hasMorePages: boolean; total: number };
    data: Array<Omit<RawAlliance, "nation_count"> & { nations: Array<{ alliance_position: string }> }>;
  };
}

export interface AllianceSnapshot {
  fetchedAt: number;
  /** Every alliance, highest score first. */
  alliances: RawAlliance[];
}

let cached: AllianceSnapshot | null = null;
let inFlight: Promise<AllianceSnapshot> | null = null;

async function fetchPage(page: number): Promise<AlliancesPage> {
  try {
    return await gql<AlliancesPage>(ALLIANCES_QUERY, { page });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("429")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return gql<AlliancesPage>(ALLIANCES_QUERY, { page });
  }
}

async function fetchAllAlliances(): Promise<{ alliances: Map<number, RawAlliance>; total: number }> {
  const alliances = new Map<number, RawAlliance>();
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const result = await fetchPage(page);
    total = result.alliances.paginatorInfo.total;
    for (const { nations, ...alliance } of result.alliances.data) {
      alliances.set(Number(alliance.id), { ...alliance, nation_count: countMembers(nations) });
    }
    if (!result.alliances.paginatorInfo.hasMorePages) break;
  }
  return { alliances, total };
}

async function loadSnapshot(): Promise<AllianceSnapshot> {
  // Alliances can shift between pages while we read them, repeating some and skipping others,
  // so retry once if the unique count doesn't match what the API says exists.
  let result = await fetchAllAlliances();
  if (result.alliances.size !== result.total) result = await fetchAllAlliances();
  const alliances = [...result.alliances.values()].sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id));
  return { fetchedAt: Date.now(), alliances };
}

/**
 * All alliances with member counts and treaties, cached for ten minutes and shared between pages.
 * Serves the last good snapshot if the P&W API errors, and only throws when there is none.
 */
export async function getAllianceSnapshot(): Promise<AllianceSnapshot> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;
  inFlight ??= loadSnapshot().finally(() => { inFlight = null; });
  try {
    cached = await inFlight;
    return cached;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}
