# War Target Finder Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/war-targets` page that lets a player enter their nation ID and see a ranked list of attackable nations from enemy alliances, with infra and military stats.

**Architecture:** A new `/api/warTargets` route reads enemy alliance IDs from `data/war-config.json`, queries the PnW GraphQL API live (your score, your active wars, enemy members), filters by score range, and returns sorted targets. The page uses `useState` + manual fetch (not `useQuery`) since the query is parameterized by user input.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS, lucide-react, PnW GraphQL API

**Spec:** `docs/superpowers/specs/2026-03-20-war-target-finder-design.md`

---

## Chunk 1: Config file + API route

### Task 1: Create the war config file

**Files:**
- Create: `data/war-config.json`

- [ ] **Step 1: Create the config file**

```json
{
  "enemy_alliance_ids": []
}
```

Save to `data/war-config.json`. This file is already git-ignored via the `data/` rule in `.gitignore`. Admin fills in actual alliance IDs before use.

- [ ] **Step 2: Commit**

```bash
git add -f data/war-config.json
git commit -m "feat: add war-config.json stub for enemy alliance IDs"
```

(Note: `data/` is in `.gitignore` so `-f` is needed to force-add this one config file. Alternatively, leave it untracked — it will be created manually on each deployment.)

Actually: do NOT commit this file since it is intentionally git-ignored and will be created by the admin on each server. Skip the commit step and just create the file locally.

---

### Task 2: Create the API route

**Files:**
- Create: `src/app/api/warTargets/route.ts`

This route is the core of the feature. It reads the config, calls PnW GraphQL in parallel, filters, and returns results. It follows the same `dynamic = "force-dynamic"` + `NextRequest`/`NextResponse` pattern as other routes.

- [ ] **Step 1: Create `src/app/api/warTargets/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const PNW_API = "https://api.politicsandwar.com/graphql";

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${PNW_API}?api_key=${process.env.PNW_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data as T;
}

const NATION_SCORE_QUERY = `
  query($id:[Int]) { nations(id:$id) { data { score } } }
`;

const OFFENSIVE_WARS_QUERY = `
  query($att_id:[Int]) { wars(att_id:$att_id, active:true) { data { def_id } } }
`;

const ENEMY_MEMBERS_QUERY = `
  query($alliance_id:[Int]) { nations(alliance_id:$alliance_id, first:500) { data {
    id nation_name leader_name score num_cities
    alliance { name }
    cities { infrastructure }
    soldiers tanks aircraft ships
    defensive_wars_count vacation_mode_turns beige_turns
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
  defensive_wars_count: number;
  vacation_mode_turns: number;
  beige_turns: number;
}

export interface WarTarget {
  id: number;
  nation_name: string;
  leader_name: string;
  alliance_name: string;
  score: number;
  num_cities: number;
  avg_infra: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  defensive_wars_count: number;
  vacation_mode_turns: number;
  beige_turns: number;
}

export interface WarTargetsResponse {
  targets: WarTarget[];
  yourScore: number;
  minScore: number;
  maxScore: number;
}

export async function GET(request: NextRequest) {
  // 1. Validate nationId
  const nationIdStr = request.nextUrl.searchParams.get("nationId");
  const nationId = Number(nationIdStr);
  if (!nationIdStr || !Number.isInteger(nationId) || nationId <= 0) {
    return NextResponse.json({ error: "nationId must be a positive integer" }, { status: 400 });
  }

  // 2. Read and validate config
  let enemyAllianceIds: number[];
  try {
    const configPath = join(process.cwd(), "data", "war-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as { enemy_alliance_ids: unknown };
    const ids = config.enemy_alliance_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "war-config.json: enemy_alliance_ids must be a non-empty array — ask an admin to add alliance IDs" },
        { status: 500 }
      );
    }
    if (ids.length > 10) {
      return NextResponse.json(
        { error: "war-config.json: too many enemy_alliance_ids (max 10)" },
        { status: 400 }
      );
    }
    enemyAllianceIds = ids.map(Number);
    if (enemyAllianceIds.some(id => !Number.isFinite(id) || id <= 0)) {
      return NextResponse.json(
        { error: "war-config.json: all enemy_alliance_ids must be positive integers" },
        { status: 500 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "data/war-config.json not found — ask an admin to create it" },
      { status: 500 }
    );
  }

  // 3. Fetch in parallel
  let nationData: { nations: { data: { score: number }[] } };
  let warsData: { wars: { data: { def_id: number }[] } };
  let allianceMembersData: { nations: { data: EnemyNation[] } }[];
  try {
    [nationData, warsData, allianceMembersData] = await Promise.all([
      gql<{ nations: { data: { score: number }[] } }>(NATION_SCORE_QUERY, { id: [nationId] }),
      gql<{ wars: { data: { def_id: number }[] } }>(OFFENSIVE_WARS_QUERY, { att_id: [nationId] }),
      Promise.all(
        enemyAllianceIds.map(id =>
          gql<{ nations: { data: EnemyNation[] } }>(ENEMY_MEMBERS_QUERY, { alliance_id: [id] })
        )
      ),
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: `PnW API error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const yourScore = nationData.nations.data[0]?.score;
  if (yourScore == null) {
    return NextResponse.json({ error: `Nation #${nationId} not found` }, { status: 404 });
  }

  const minScore = Math.floor(yourScore * 0.75);
  const maxScore = Math.ceil(yourScore * 4 / 3);
  const atWarWith = new Set(warsData.wars.data.map(w => Number(w.def_id)));

  const allEnemyNations = allianceMembersData.flatMap(d => d.nations.data);

  const targets: WarTarget[] = allEnemyNations
    .filter(n => n.score >= minScore && n.score <= maxScore)
    .filter(n => !atWarWith.has(n.id))
    .map(n => ({
      id: n.id,
      nation_name: n.nation_name,
      leader_name: n.leader_name,
      alliance_name: n.alliance?.name ?? "Unknown",
      score: n.score,
      num_cities: n.num_cities,
      avg_infra: n.cities.length > 0
        ? Math.round(n.cities.reduce((s, c) => s + c.infrastructure, 0) / n.cities.length)
        : 0,
      soldiers: n.soldiers,
      tanks: n.tanks,
      aircraft: n.aircraft,
      ships: n.ships,
      defensive_wars_count: n.defensive_wars_count,
      vacation_mode_turns: n.vacation_mode_turns,
      beige_turns: n.beige_turns,
    }))
    .sort((a, b) => b.avg_infra - a.avg_infra);

  const response: WarTargetsResponse = { targets, yourScore, minScore, maxScore };
  return NextResponse.json(response);
}
```

- [ ] **Step 2: Build and verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -30
```

Expected: build succeeds (or only unrelated errors). Fix any TypeScript errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/warTargets/route.ts
git commit -m "feat: add /api/warTargets route for live enemy nation lookup"
```

---

## Chunk 2: Page UI + sidebar

### Task 3: Create the war targets page

**Files:**
- Create: `src/app/war-targets/page.tsx`

This page uses `useState` + manual fetch (not `useQuery`) since results are parameterized by user input. Follow the CLAUDE.md Rules of Hooks note: all `useMemo` calls must come before any conditional returns.

- [ ] **Step 1: Create `src/app/war-targets/page.tsx`**

```typescript
"use client";
import { useState, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Crosshair, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { WarTarget, WarTargetsResponse } from "@/app/api/warTargets/route";

type SortKey = keyof WarTarget;
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
  { key: "leader_name", label: "Leader" },
  { key: "alliance_name", label: "Alliance" },
  { key: "score", label: "Score" },
  { key: "num_cities", label: "Cities" },
  { key: "avg_infra", label: "Avg Infra" },
  { key: "soldiers", label: "Soldiers" },
  { key: "tanks", label: "Tanks" },
  { key: "aircraft", label: "Aircraft" },
  { key: "ships", label: "Ships" },
  { key: "defensive_wars_count", label: "Def Wars" },
  // Status column is non-sortable (composite of 3 badge conditions) — rendered separately below
];

export default function WarTargetsPage() {
  const [nationIdInput, setNationIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WarTargetsResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("avg_infra");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // All useMemo calls before any conditional returns (Rules of Hooks)
  const sorted = useMemo(() => {
    if (!result) return [];
    return [...result.targets].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string"
        ? (av as string).localeCompare(bv as string)
        : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [result, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function handleFind() {
    const id = Number(nationIdInput);
    if (!Number.isInteger(id) || id <= 0) {
      setError("Please enter a valid nation ID");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/warTargets?nationId=${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unknown error");
      } else {
        setResult(data as WarTargetsResponse);
      }
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Crosshair size={20} className="text-red-400" />
            War Target Finder
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Find attackable nations in enemy alliances within your score range
          </p>
        </div>

        {/* Input */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Your Nation ID
            </label>
            <input
              type="number"
              min={1}
              value={nationIdInput}
              onChange={e => setNationIdInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleFind()}
              placeholder="e.g. 12345"
              className="w-40 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleFind}
            disabled={loading || !nationIdInput}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            <Crosshair size={14} />
            Find Targets
          </button>
        </div>

        {/* Score range banner */}
        {result && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl px-4 py-3 text-sm text-slate-300">
            Score: <strong className="text-white">{fmt(result.yourScore)}</strong>
            <span className="mx-3 text-slate-500">→</span>
            Attack range: <strong className="text-green-400">{fmt(result.minScore)}</strong>
            <span className="mx-1 text-slate-500">–</span>
            <strong className="text-red-400">{fmt(result.maxScore)}</strong>
            <span className="ml-4 text-slate-400">({result.targets.length} targets found)</span>
          </div>
        )}

        {/* States */}
        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!loading && result && result.targets.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Crosshair size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">No attackable targets found</p>
            <p className="text-slate-400 text-sm mt-1">
              No enemy nations are within your score range ({fmt(result.minScore)} – {fmt(result.maxScore)})
            </p>
          </div>
        )}

        {!loading && !result && !error && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Crosshair size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">Enter your nation ID to find targets</p>
            <p className="text-slate-400 text-sm mt-1">
              Shows nations in enemy alliances within 75%–133% of your score
            </p>
          </div>
        )}

        {/* Results table */}
        {!loading && sorted.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
            <table className="w-full text-sm">
              <thead className="bg-[#161b2e] border-b border-[#2a3150]">
                <tr>
                  {COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white whitespace-nowrap select-none"
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                  {/* Status column is non-sortable — composite badge state */}
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a3150]">
                {sorted.map(t => (
                  <tr key={t.id} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={`https://politicsandwar.com/nation/id=${t.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-medium"
                      >
                        {t.nation_name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.leader_name}</td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.alliance_name}</td>
                    <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{fmt(t.score)}</td>
                    <td className="px-3 py-2 text-slate-200">{t.num_cities}</td>
                    <td className="px-3 py-2 text-slate-200 font-medium">{fmt(t.avg_infra)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(t.soldiers)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(t.tanks)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(t.aircraft)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(t.ships)}</td>
                    <td className="px-3 py-2">
                      <span className={`font-medium ${t.defensive_wars_count >= 3 ? "text-orange-400" : "text-slate-200"}`}>
                        {t.defensive_wars_count}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 flex-wrap">
                        {t.defensive_wars_count >= 3 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400 border border-orange-700/30">
                            Slotted
                          </span>
                        )}
                        {t.beige_turns > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-700/30">
                            Beige
                          </span>
                        )}
                        {t.vacation_mode_turns > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600/30">
                            VM
                          </span>
                        )}
                      </div>
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

- [ ] **Step 2: Build and verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -30
```

Expected: build succeeds. Fix any TypeScript errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/app/war-targets/page.tsx
git commit -m "feat: add /war-targets page with sortable target table"
```

---

### Task 4: Add sidebar nav entry

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add `Crosshair` to the import and add the nav entry**

In `src/components/Sidebar.tsx`, change the lucide-react import line to add `Crosshair`:

```typescript
import { LayoutDashboard, Users, Swords, Landmark, BarChart2, Shield, Building2, Search, Clock, Calculator, Target, UserPlus, DollarSign, Crosshair } from "lucide-react";
```

Add the nav entry immediately after the existing `"Wars"` entry (this is an insertion, not a replacement — do not remove the Wars entry):

```typescript
  { label: "Wars", href: "/wars", icon: Swords },
  { label: "War Targets", href: "/war-targets", icon: Crosshair },  // ← insert this line
  { label: "Bank", href: "/bank", icon: Landmark },
```

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add War Targets to sidebar nav"
```

---

## Chunk 3: Deploy and smoke test

### Task 5: Deploy and verify

- [ ] **Step 1: Ensure `data/war-config.json` has real alliance IDs**

Edit `data/war-config.json` and add the actual enemy alliance IDs:

```json
{
  "enemy_alliance_ids": [<real_id_1>, <real_id_2>]
}
```

- [ ] **Step 2: Build production bundle**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Restart the server (use the kill-and-restart pattern from CLAUDE.md)**

```bash
kill -9 $(ss -tlnp | grep ':3000' | grep -oP 'pid=\K[0-9]+')
nohup npm run start > /tmp/nextjs.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: `200`

- [ ] **Step 4: Smoke test the API route directly**

```bash
curl -s "http://localhost:3000/api/warTargets?nationId=<your_nation_id>" | head -c 500
```

Expected: JSON with `targets`, `yourScore`, `minScore`, `maxScore` keys.

- [ ] **Step 5: Verify error cases**

```bash
# Missing nationId
curl -s "http://localhost:3000/api/warTargets" | python3 -m json.tool

# Non-numeric nationId
curl -s "http://localhost:3000/api/warTargets?nationId=abc" | python3 -m json.tool
```

Expected: `{"error": "nationId must be a positive integer"}` with HTTP 400.

- [ ] **Step 6: Navigate to `/war-targets` in the browser**

Verify:
- Sidebar shows "War Targets" link with Crosshair icon
- Page loads with the empty prompt state
- Entering your nation ID and clicking "Find Targets" shows the score banner + table
- Columns are sortable (click headers)
- Nation names link to `https://politicsandwar.com/nation/id=<id>`
- Slotted/Beige/VM badges appear correctly
