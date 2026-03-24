# Beige Watch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/beige-watch` page that shows enemy nations currently on beige, sorted by turns remaining, with optional score-range filtering by nation ID and client-side filters for beige turns and city count.

**Architecture:** New live-data API route `/api/beigeWatch` mirrors `/api/warTargets` — calls PnW GraphQL on each request, filters to `beige_turns > 0`, optionally annotates each nation with an `inRange` boolean when a `nationId` query param is provided. The page auto-loads on mount and applies client-side filters via a single `useMemo`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS, lucide-react, PnW GraphQL API, better-sqlite3 (for trade prices)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/app/api/beigeWatch/route.ts` | **Create** | Live API route — fetches enemy beige nations, optional score range, beige loot history |
| `src/app/beige-watch/page.tsx` | **Create** | Client page — inputs bar, sortable table, client-side filters |
| `src/components/Sidebar.tsx` | **Modify** | Add `ShieldOff` import + `Beige Watch` entry to `hiddenNav` |

---

## Chunk 1: API Route

### Task 1: Create `/api/beigeWatch` route

**Files:**
- Create: `src/app/api/beigeWatch/route.ts`

**Reference:** `src/app/api/warTargets/route.ts` — same `gql()` helper, query strings, loot logic, and `allSettled` pattern. Key differences: `nationId` is optional; filter is `beige_turns > 0` only; loot pagination capped at 5 pages; `inRange` field added.

- [ ] **Step 1: Create the API route file**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

const PNW_API = "https://api.politicsandwar.com/graphql";

async function gql<T>(query: string, variables?: Record<string, unknown>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${PNW_API}?api_key=${process.env.PNW_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error("PnW API rate limited (429) — try again in a moment");
    }
    if (!res.ok) throw new Error(`PnW API HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data as T;
  }
  throw new Error("PnW API request failed after retries");
}

const NATION_SCORE_QUERY = `
  query($id:[Int]) { nations(id:$id) { data { score leader_name discord } } }
`;

const BEIGE_WARS_QUERY = `
  query($ids:[Int], $after:DateTime, $page:Int) { wars(or_id:$ids, active:false, after:$after, first:500, page:$page) { data {
    date att_id def_id winner_id
    attacks {
      money_looted coal_looted oil_looted uranium_looted iron_looted bauxite_looted
      lead_looted gasoline_looted munitions_looted steel_looted aluminum_looted food_looted
    }
  } } }
`;

const ENEMY_MEMBERS_QUERY = `
  query($alliance_id:[Int]) { nations(alliance_id:$alliance_id, first:500) { data {
    id nation_name leader_name score num_cities
    alliance { name }
    cities { infrastructure }
    soldiers tanks aircraft ships
    offensive_wars_count defensive_wars_count vacation_mode_turns beige_turns
  } } }
`;

interface EnemyNation {
  id: number;
  nation_name: string;
  leader_name: string;
  score: number;
  num_cities: number;
  alliance: { name: string } | null;
  cities: { infrastructure: number }[];
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  offensive_wars_count: number;
  defensive_wars_count: number;
  vacation_mode_turns: number;
  beige_turns: number;
}

export interface BeigeNation {
  id: number;
  nation_name: string;
  leader_name: string;
  alliance_name: string;
  score: number;
  num_cities: number;
  avg_infra: number;
  beige_turns: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  offensive_wars_count: number;
  defensive_wars_count: number;
  inRange: boolean | null;
  beige_loot: number | null;
  beige_date: string | null;
  beige_avg: number | null;
  beige_count: number | null;
}

export interface BeigeWatchResponse {
  nations: BeigeNation[];
  yourScore?: number;
  minScore?: number;
  maxScore?: number;
  yourLeader?: string;
  yourDiscord?: string | null;
}

export async function GET(request: NextRequest) {
  if (!process.env.PNW_API_KEY) {
    return NextResponse.json({ error: "PNW_API_KEY is not configured" }, { status: 500 });
  }

  // Optional nationId
  const nationIdStr = request.nextUrl.searchParams.get("nationId");
  const nationId = nationIdStr ? Number(nationIdStr) : null;
  if (nationIdStr !== null && (!Number.isInteger(nationId) || (nationId as number) <= 0)) {
    return NextResponse.json({ error: "nationId must be a positive integer" }, { status: 400 });
  }

  // Read war config
  let rawIds: unknown;
  try {
    const configPath = join(process.cwd(), "data", "war-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as { enemy_alliance_ids: unknown };
    rawIds = config.enemy_alliance_ids;
  } catch {
    return NextResponse.json(
      { error: "data/war-config.json not found or invalid JSON — ask an admin to check it" },
      { status: 500 }
    );
  }
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json(
      { error: "war-config.json: enemy_alliance_ids must be a non-empty array" },
      { status: 500 }
    );
  }
  const enemyAllianceIds = rawIds.map(Number);
  if (enemyAllianceIds.some(id => !Number.isFinite(id) || id <= 0)) {
    return NextResponse.json(
      { error: "war-config.json: all enemy_alliance_ids must be positive integers" },
      { status: 500 }
    );
  }

  // Fetch all enemy alliance members
  const memberResults = await Promise.allSettled(
    enemyAllianceIds.map(id =>
      gql<{ nations: { data: EnemyNation[] } }>(ENEMY_MEMBERS_QUERY, { alliance_id: [id] })
    )
  );
  const failedCount = memberResults.filter(r => r.status === "rejected").length;
  if (failedCount === memberResults.length) {
    return NextResponse.json({ error: "PnW API error: all alliance queries failed" }, { status: 502 });
  }
  const allEnemyNations = memberResults
    .filter((r): r is PromiseFulfilledResult<{ nations: { data: EnemyNation[] } }> => r.status === "fulfilled")
    .flatMap(r => r.value.nations.data);

  // Filter to beige nations only — no other server-side filtering
  const beigeNations = allEnemyNations.filter(n => n.beige_turns > 0);

  // Score range — only if nationId provided
  let yourScore: number | undefined;
  let yourLeader: string | undefined;
  let yourDiscord: string | null | undefined;
  let minScore: number | undefined;
  let maxScore: number | undefined;

  if (nationId !== null) {
    let nationData: { nations: { data: { score: number; leader_name: string; discord: string | null }[] } };
    try {
      nationData = await gql<{ nations: { data: { score: number; leader_name: string; discord: string | null }[] } }>(
        NATION_SCORE_QUERY, { id: [nationId] }
      );
    } catch (err) {
      return NextResponse.json(
        { error: `PnW API error: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 }
      );
    }
    const yourNation = nationData.nations.data[0];
    if (yourNation == null) {
      return NextResponse.json({ error: `Nation #${nationId} not found` }, { status: 404 });
    }
    yourScore = yourNation.score;
    yourLeader = yourNation.leader_name;
    yourDiscord = yourNation.discord ?? null;
    minScore = Math.floor(yourScore * 0.75);
    maxScore = Math.ceil(yourScore * 4 / 3);
  }

  // Trade prices from SQLite for resource valuation
  type Prices = {
    coal: number; oil: number; uranium: number; iron: number; bauxite: number;
    lead: number; gasoline: number; munitions: number; steel: number; aluminum: number; food: number;
  };
  let prices: Prices | null = null;
  try {
    const row = db.prepare("SELECT data FROM trade_prices WHERE id = 1").get() as { data: string } | undefined;
    if (row) prices = JSON.parse(row.data) as Prices;
  } catch { /* no prices available */ }

  type LootAttack = {
    money_looted: number; coal_looted: number; oil_looted: number; uranium_looted: number;
    iron_looted: number; bauxite_looted: number; lead_looted: number; gasoline_looted: number;
    munitions_looted: number; steel_looted: number; aluminum_looted: number; food_looted: number;
  };

  function attackLootValue(attacks: LootAttack[]): number {
    const p = prices;
    return attacks.reduce((sum, a) => {
      const resourceValue = !p ? 0
        : a.coal_looted * p.coal + a.oil_looted * p.oil + a.uranium_looted * p.uranium
        + a.iron_looted * p.iron + a.bauxite_looted * p.bauxite + a.lead_looted * p.lead
        + a.gasoline_looted * p.gasoline + a.munitions_looted * p.munitions
        + a.steel_looted * p.steel + a.aluminum_looted * p.aluminum + a.food_looted * p.food;
      return sum + a.money_looted + resourceValue;
    }, 0);
  }

  // Beige loot pagination (capped at 5 pages)
  const targetIds = beigeNations.map(n => Number(n.id));
  const targetIdSet = new Set(targetIds);
  const beigeMap = new Map<number, { loot: number; date: string; allLoots: number[] }>();

  type BeigeWar = { date: string; att_id: string; def_id: string; winner_id: string; attacks: LootAttack[] };

  function recordIfLoss(w: BeigeWar) {
    if (w.winner_id === "0") return;
    const loserId = w.winner_id === w.att_id ? Number(w.def_id) : Number(w.att_id);
    if (!targetIdSet.has(loserId)) return;
    const loot = attackLootValue(w.attacks);
    const existing = beigeMap.get(loserId);
    if (!existing) {
      beigeMap.set(loserId, { loot, date: w.date, allLoots: [loot] });
    } else {
      existing.allLoots.push(loot);
      if (w.date > existing.date) {
        existing.loot = loot;
        existing.date = w.date;
      }
    }
  }

  if (targetIds.length > 0) {
    try {
      const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const after = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 00:00:00`;
      for (let page = 1; ; page++) {
        const beigeData = await gql<{ wars: { data: BeigeWar[] } }>(
          BEIGE_WARS_QUERY, { ids: targetIds, after, page }
        );
        const wars = beigeData.wars.data;
        for (const w of wars) recordIfLoss(w);
        if (wars.length < 500 || page >= 5) break;
      }
    } catch (e) {
      console.error("[BeigeWatch] Beige loot query failed:", e instanceof Error ? e.message : e);
    }
  }

  // Build response
  const nations: BeigeNation[] = beigeNations
    .map(n => {
      const beige = beigeMap.get(Number(n.id));
      const inRange = (minScore !== undefined && maxScore !== undefined)
        ? (n.score >= minScore && n.score <= maxScore)
        : null;
      return {
        id: n.id,
        nation_name: n.nation_name,
        leader_name: n.leader_name,
        alliance_name: n.alliance?.name ?? "Unknown",
        score: n.score,
        num_cities: n.num_cities,
        avg_infra: n.cities.length > 0
          ? Math.round(n.cities.reduce((s, c) => s + c.infrastructure, 0) / n.cities.length)
          : 0,
        beige_turns: n.beige_turns,
        soldiers: n.soldiers,
        tanks: n.tanks,
        aircraft: n.aircraft,
        ships: n.ships,
        offensive_wars_count: n.offensive_wars_count,
        defensive_wars_count: n.defensive_wars_count,
        inRange,
        beige_loot: beige?.loot ?? null,
        beige_date: beige?.date ?? null,
        beige_avg: beige ? Math.round(beige.allLoots.reduce((s, v) => s + v, 0) / beige.allLoots.length) : null,
        beige_count: beige?.allLoots.length ?? null,
      };
    })
    .sort((a, b) => a.beige_turns - b.beige_turns);

  const response: BeigeWatchResponse = {
    nations,
    ...(yourScore !== undefined && {
      yourScore,
      minScore,
      maxScore,
      yourLeader,
      yourDiscord,
    }),
  };
  return NextResponse.json(response);
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript or build errors. If errors appear, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/beigeWatch/route.ts
git commit -m "feat: add /api/beigeWatch live route for enemy beige nations"
```

---

## Chunk 2: Page + Sidebar

### Task 2: Create the `/beige-watch` page

**Files:**
- Create: `src/app/beige-watch/page.tsx`

**Reference:** `src/app/war-targets/page.tsx` — same `AppShell`, `LoadingSpinner`, sort pattern, and table structure. Key differences: auto-load on mount; `nationId` optional; four inputs instead of one; single `useMemo` for filter+sort; `inRange` column conditionally rendered; two distinct empty states; `beige_turns` color coding.

- [ ] **Step 4: Create the page file**

```typescript
"use client";
import { useState, useMemo, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ShieldOff, ChevronUp, ChevronDown, ChevronsUpDown, Swords } from "lucide-react";
import type { BeigeNation, BeigeWatchResponse } from "@/app/api/beigeWatch/route";

type SortKey = keyof BeigeNation;
type SortDir = "asc" | "desc";

function fmt(n: number) {
  return n.toLocaleString();
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={12} className="text-slate-600" />;
  return sortDir === "asc"
    ? <ChevronUp size={12} className="text-blue-400" />
    : <ChevronDown size={12} className="text-blue-400" />;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "nation_name", label: "Nation" },
  { key: "alliance_name", label: "Alliance" },
  { key: "beige_turns", label: "Beige Turns" },
  { key: "inRange", label: "In Range" },
  { key: "score", label: "Score" },
  { key: "num_cities", label: "Cities" },
  { key: "avg_infra", label: "Avg Infra" },
  { key: "soldiers", label: "Soldiers" },
  { key: "tanks", label: "Tanks" },
  { key: "aircraft", label: "Aircraft" },
  { key: "ships", label: "Ships" },
  { key: "offensive_wars_count", label: "Off Wars" },
  { key: "defensive_wars_count", label: "Def Wars" },
  { key: "beige_loot", label: "Beige Loot" },
  { key: "beige_avg", label: "Avg Beige" },
];

export default function BeigeWatchPage() {
  const [nationIdInput, setNationIdInput] = useState("");
  const [maxBeigeTurns, setMaxBeigeTurns] = useState("");
  const [minCities, setMinCities] = useState("");
  const [maxCities, setMaxCities] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BeigeWatchResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("beige_turns");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Single useMemo for filter + sort — MUST be before any conditional early returns
  const displayedNations = useMemo(() => {
    if (!result) return [];
    let nations = [...result.nations];

    // Client-side filters
    if (maxBeigeTurns !== "") {
      const max = Number(maxBeigeTurns);
      if (Number.isFinite(max)) nations = nations.filter(n => n.beige_turns <= max);
    }
    if (minCities !== "") {
      const min = Number(minCities);
      if (Number.isFinite(min)) nations = nations.filter(n => n.num_cities >= min);
    }
    if (maxCities !== "") {
      const max = Number(maxCities);
      if (Number.isFinite(max)) nations = nations.filter(n => n.num_cities <= max);
    }

    // Sort
    return nations.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      // Special-case inRange (boolean | null) — generic number subtraction produces NaN
      if (sortKey === "inRange") {
        const toNum = (v: boolean | null) => v === true ? 1 : v === false ? 0 : -1;
        const cmp = toNum(av as boolean | null) - toNum(bv as boolean | null);
        return sortDir === "asc" ? cmp : -cmp;
      }

      const cmp = typeof av === "string"
        ? (av as string).localeCompare(bv as string)
        : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [result, sortKey, sortDir, maxBeigeTurns, minCities, maxCities]);

  // Single useEffect on mount
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("nationId");
    if (id && Number.isInteger(Number(id)) && Number(id) > 0) {
      setNationIdInput(id);
      fetchNations(Number(id));
    } else {
      fetchNations(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function fetchNations(id: number | null) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const url = id != null ? `/api/beigeWatch?nationId=${id}` : "/api/beigeWatch";
      const res = await fetch(url);
      if (!res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        const data = ct.includes("application/json") ? await res.json() : null;
        setError(data?.error ?? `Server error (${res.status})`);
      } else {
        setResult(await res.json() as BeigeWatchResponse);
      }
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }

  function handleLoad() {
    const id = nationIdInput ? Number(nationIdInput) : null;
    if (nationIdInput && (!Number.isInteger(id) || (id as number) <= 0)) {
      setError("Please enter a valid nation ID");
      return;
    }
    fetchNations(id);
  }

  const showInRange = !!result?.yourScore;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldOff size={20} className="text-amber-400" />
            Beige Watch
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Enemy nations currently on beige — sorted by turns remaining
          </p>
        </div>

        {/* Inputs bar */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label htmlFor="nation-id-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Your Nation ID
              </label>
              {result?.yourLeader && (
                <span className="text-xs text-slate-300 font-medium">
                  {result.yourLeader}{result.yourDiscord ? <span className="text-slate-500 ml-1">{result.yourDiscord}</span> : null}
                </span>
              )}
            </div>
            <input
              id="nation-id-input"
              type="number"
              min={1}
              value={nationIdInput}
              onChange={e => setNationIdInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLoad()}
              placeholder="optional"
              className="w-32 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="max-beige-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Max Beige Turns
            </label>
            <input
              id="max-beige-input"
              type="number"
              min={1}
              value={maxBeigeTurns}
              onChange={e => setMaxBeigeTurns(e.target.value)}
              placeholder="any"
              className="w-28 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="min-cities-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Min Cities
            </label>
            <input
              id="min-cities-input"
              type="number"
              min={1}
              value={minCities}
              onChange={e => setMinCities(e.target.value)}
              placeholder="any"
              className="w-24 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="max-cities-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Max Cities
            </label>
            <input
              id="max-cities-input"
              type="number"
              min={1}
              value={maxCities}
              onChange={e => setMaxCities(e.target.value)}
              placeholder="any"
              className="w-24 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={handleLoad}
            disabled={loading}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            <ShieldOff size={14} />
            Load
          </button>
        </div>

        {/* Score range banner */}
        {result?.yourScore != null && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl px-4 py-3 text-sm text-slate-300">
            Score: <strong className="text-white">{fmt(Math.round(result.yourScore))}</strong>
            <span className="mx-3 text-slate-500">→</span>
            Attack range: <strong className="text-green-400">{fmt(result.minScore!)}</strong>
            <span className="mx-1 text-slate-500">–</span>
            <strong className="text-red-400">{fmt(result.maxScore!)}</strong>
            <span className="ml-4 text-slate-400">({displayedNations.length} nations shown)</span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Empty — server returned no beige nations */}
        {!loading && result && result.nations.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <ShieldOff size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">No nations are currently on beige</p>
            <p className="text-slate-400 text-sm mt-1">No enemy nations are currently protected by beige</p>
          </div>
        )}

        {/* Empty — filters eliminated all results */}
        {!loading && result && result.nations.length > 0 && displayedNations.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <ShieldOff size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">No nations match your filters</p>
            <p className="text-slate-400 text-sm mt-1">Try loosening the beige turns or city count filters</p>
          </div>
        )}

        {/* Results table */}
        {!loading && displayedNations.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
            <table className="w-full text-sm">
              <thead className="bg-[#161b2e] border-b border-[#2a3150]">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap"></th>
                  {COLUMNS.map(({ key, label }) => {
                    if (key === "inRange" && !showInRange) return null;
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        onKeyDown={e => (e.key === "Enter" || e.key === " ") && handleSort(key)}
                        tabIndex={0}
                        className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white whitespace-nowrap select-none"
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a3150]">
                {displayedNations.map(n => (
                  <tr key={n.id} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={`https://politicsandwar.com/nation/war/declare/id=${n.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 bg-red-700/80 hover:bg-red-600 text-white text-xs font-semibold rounded transition-colors"
                      >
                        <Swords size={11} />
                        War
                      </a>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={`https://politicsandwar.com/nation/id=${n.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-medium"
                      >
                        {n.nation_name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{n.alliance_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`font-semibold ${n.beige_turns <= 6 ? "text-red-400" : "text-amber-400"}`}>
                        {n.beige_turns}
                      </span>
                    </td>
                    {showInRange && (
                      <td className="px-3 py-2">
                        {n.inRange === null ? null : (
                          <span
                            className={`inline-block w-2.5 h-2.5 rounded-full ${n.inRange ? "bg-green-500" : "bg-slate-600"}`}
                            title={n.inRange ? "In score range" : "Out of score range"}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{fmt(Math.round(n.score))}</td>
                    <td className="px-3 py-2 text-slate-200">{n.num_cities}</td>
                    <td className="px-3 py-2 text-slate-200 font-medium">{fmt(n.avg_infra)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(n.soldiers)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(n.tanks)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(n.aircraft)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(n.ships)}</td>
                    <td className="px-3 py-2 text-slate-200">{n.offensive_wars_count}</td>
                    <td className="px-3 py-2">
                      <span className={`font-medium ${n.defensive_wars_count >= 3 ? "text-orange-400" : "text-slate-200"}`}>
                        {n.defensive_wars_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {n.beige_loot != null ? (
                        <div>
                          <div className="text-green-400 font-medium">${fmt(Math.round(n.beige_loot))}</div>
                          {n.beige_date && <div className="text-slate-500 text-xs">{new Date(n.beige_date).toLocaleDateString()}</div>}
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {n.beige_avg != null ? (
                        <div>
                          <div className="text-green-300 font-medium">${fmt(n.beige_avg)}</div>
                          <div className="text-slate-500 text-xs">{n.beige_count} war{n.beige_count === 1 ? "" : "s"}</div>
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Verify the build compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript or build errors. Fix any before proceeding.

- [ ] **Step 6: Commit the page**

```bash
git add src/app/beige-watch/page.tsx
git commit -m "feat: add /beige-watch page with sortable table and client-side filters"
```

---

### Task 3: Add Beige Watch to the sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx`

Two changes: (1) add `ShieldOff` to the lucide-react import; (2) add a `Beige Watch` entry to `hiddenNav`.

- [ ] **Step 7: Update Sidebar.tsx**

In `src/components/Sidebar.tsx`, change the lucide-react import (line 5–9) to include `ShieldOff`:

```typescript
import {
  LayoutDashboard, Users, Swords, Landmark, BarChart2, Shield,
  Building2, Search, Clock, Calculator, Target, UserPlus,
  DollarSign, Crosshair, Flame, Radio, LogOut, Settings, ShieldOff,
} from "lucide-react";
```

Then add the Beige Watch entry to `hiddenNav` after `Command Center`:

```typescript
  { label: "Command Center", href: "/command-center", icon: Radio },
  { label: "Beige Watch", href: "/beige-watch", icon: ShieldOff },
```

- [ ] **Step 8: Verify the build compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add Beige Watch to sidebar nav"
```

---

### Task 4: Deploy and smoke-test

- [ ] **Step 10: Restart production server**

```bash
kill -9 $(ss -tlnp | grep ':3000' | grep -oP 'pid=\K[0-9]+')
nohup npm run start > /tmp/nextjs.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: `200`

- [ ] **Step 11: Smoke-test the API route**

```bash
curl -s "http://localhost:3000/api/beigeWatch" | head -c 200
```

Expected: JSON with a `nations` array (may be empty if no enemy nations are currently on beige — that's valid).

- [ ] **Step 12: Verify the page loads**

Navigate to `http://localhost:3000/beige-watch` in a browser. Confirm:
- Page renders with header "Beige Watch"
- Inputs bar is visible (Nation ID, Max Beige Turns, Min Cities, Max Cities, Load button)
- Spinner shows briefly on mount, then either a table or the "No nations are currently on beige" empty state
- Load button is not disabled when nation ID input is empty
- Entering a nation ID and clicking Load shows the score range banner and the In Range column

- [ ] **Step 13: Verify sidebar entry**

After logging in via Discord OAuth, confirm "Beige Watch" appears in the sidebar nav under the hidden (member) section.
