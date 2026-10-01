# AI Targets Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a member-only `/ai-targets` page that sends war target data to a local Ollama instance and displays the AI's top 5 picks for maximum infra damage and maximum loot.

**Architecture:** A self-contained `/api/aiTargets` GET route reads the session, looks up the nation from SQLite, fetches enemy targets from PnW GraphQL (duplicating warTargets logic intentionally), passes all valid targets to Ollama (`qwen3.5:397b-cloud`), enriches AI picks with full stats, and returns structured JSON. The page is a simple `"use client"` component with idle/loading/error/success states.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS, TanStack Query, better-sqlite3, Ollama REST API (`http://localhost:11434/api/chat`)

**Spec:** `docs/superpowers/specs/2026-03-24-ai-targets-design.md`

---

## Chunk 1: API Route

### Task 1: Create shared types, then `/api/aiTargets/route.ts`

**Files:**
- Create: `src/lib/aiTargets.ts` — shared types only (no Node.js imports)
- Create: `src/app/api/aiTargets/route.ts`

The types must live in a separate file. The route imports `better-sqlite3` at the top level, so any client page that imports directly from the route file will fail to build. `src/lib/aiTargets.ts` has no Node.js dependencies and is safe to import from both the route and the page.

**Reference:** Copy GraphQL query strings and filter/beige logic from `src/app/api/warTargets/route.ts`. The duplication is intentional per spec.

- [ ] **Step 1a: Create `src/lib/aiTargets.ts`**

```typescript
// src/lib/aiTargets.ts
export interface AiPick {
  nation_id: number;
  nation_name: string;
  alliance_name: string;
  avg_infra: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  defensive_wars_count: number;
  beige_avg: number | null;
  beige_count: number | null;
  reason: string;
}

export interface AiTargetsResponse {
  damage_picks: AiPick[];
  loot_picks: AiPick[];
  summary: string;
  target_count: number;
}
```

- [ ] **Step 1b: Create the route file with types, GraphQL queries, and helpers**

Import `AiPick` and `AiTargetsResponse` from `@/lib/aiTargets` at the top of the route.

```typescript
// src/app/api/aiTargets/route.ts
import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import db from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PNW_API = "https://api.politicsandwar.com/graphql";

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${PNW_API}?api_key=${process.env.PNW_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`PnW API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data as T;
}

const NATION_SCORE_QUERY = `
  query($id:[Int]) { nations(id:$id) { data { score leader_name } } }
`;
const OFFENSIVE_WARS_QUERY = `
  query($attid:[Int]) { wars(attid:$attid, active:true) { data { def_id } } }
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
const BEIGE_WARS_QUERY = `
  query($ids:[Int], $after:DateTime, $page:Int) { wars(or_id:$ids, active:false, after:$after, first:500, page:$page) { data {
    date att_id def_id winner_id
    attacks {
      money_looted coal_looted oil_looted uranium_looted iron_looted bauxite_looted
      lead_looted gasoline_looted munitions_looted steel_looted aluminum_looted food_looted
    }
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

type Prices = {
  coal: number; oil: number; uranium: number; iron: number; bauxite: number;
  lead: number; gasoline: number; munitions: number; steel: number; aluminum: number; food: number;
};

type LootAttack = {
  money_looted: number; coal_looted: number; oil_looted: number; uranium_looted: number;
  iron_looted: number; bauxite_looted: number; lead_looted: number; gasoline_looted: number;
  munitions_looted: number; steel_looted: number; aluminum_looted: number; food_looted: number;
};

type BeigeWar = {
  date: string; att_id: string; def_id: string; winner_id: string; attacks: LootAttack[];
};

interface TargetData {
  nation_id: number;
  nation_name: string;
  alliance_name: string;
  avg_infra: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  defensive_wars_count: number;
  beige_avg: number | null;
  beige_count: number | null;
}

export interface AiPick {
  nation_id: number;
  nation_name: string;
  alliance_name: string;
  avg_infra: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  defensive_wars_count: number;
  beige_avg: number | null;
  beige_count: number | null;
  reason: string;
}

export interface AiTargetsResponse {
  damage_picks: AiPick[];
  loot_picks: AiPick[];
  summary: string;
  target_count: number;
}
```

- [ ] **Step 2: Add the GET handler — auth, nation lookup, config**

Append to the same file:

```typescript
export async function GET() {
  if (!process.env.PNW_API_KEY) {
    return NextResponse.json({ error: "PNW_API_KEY is not configured" }, { status: 500 });
  }

  // 1. Auth
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Nation lookup — check both nations and applicants tables
  const nationRow = db.prepare(`
    SELECT id FROM nations WHERE LOWER(json_extract(data, '$.discord')) = LOWER(?)
    UNION
    SELECT id FROM applicants WHERE LOWER(json_extract(data, '$.discord')) = LOWER(?)
    LIMIT 1
  `).get(session.username, session.username) as { id: number } | undefined;

  if (!nationRow) {
    return NextResponse.json(
      { error: "Your Discord username isn't linked to a PnW nation. Make sure your in-game Discord field matches your Discord username." },
      { status: 404 }
    );
  }
  const nationId = nationRow.id;

  // 3. Read enemy alliance IDs
  let enemyAllianceIds: number[];
  try {
    const config = JSON.parse(readFileSync(join(process.cwd(), "data", "war-config.json"), "utf-8"));
    if (!Array.isArray(config.enemy_alliance_ids) || config.enemy_alliance_ids.length === 0) {
      return NextResponse.json({ error: "No enemy alliances configured" }, { status: 500 });
    }
    enemyAllianceIds = config.enemy_alliance_ids.map(Number);
  } catch {
    return NextResponse.json({ error: "war-config.json not found or invalid" }, { status: 500 });
  }

  // 4. Fetch nation score + offensive wars
  let yourScore: number;
  let atWarWith: Set<number>;
  try {
    const [nationData, warsData] = await Promise.all([
      gql<{ nations: { data: { score: number }[] } }>(NATION_SCORE_QUERY, { id: [nationId] }),
      gql<{ wars: { data: { def_id: number }[] } }>(OFFENSIVE_WARS_QUERY, { attid: [nationId] }),
    ]);
    if (!nationData.nations.data[0]) {
      return NextResponse.json({ error: `Nation #${nationId} not found` }, { status: 404 });
    }
    yourScore = nationData.nations.data[0].score;
    atWarWith = new Set(warsData.wars.data.map(w => Number(w.def_id)));
  } catch (err) {
    return NextResponse.json(
      { error: `PnW API error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const minScore = Math.floor(yourScore * 0.75);
  const maxScore = Math.ceil(yourScore * 4 / 3);

  // 5. Fetch enemy members
  const memberResults = await Promise.allSettled(
    enemyAllianceIds.map(id =>
      gql<{ nations: { data: EnemyNation[] } }>(ENEMY_MEMBERS_QUERY, { alliance_id: [id] })
    )
  );
  if (memberResults.every(r => r.status === "rejected")) {
    return NextResponse.json({ error: "PnW API error: all alliance queries failed" }, { status: 502 });
  }
  const allEnemyNations = memberResults
    .filter((r): r is PromiseFulfilledResult<{ nations: { data: EnemyNation[] } }> => r.status === "fulfilled")
    .flatMap(r => r.value.nations.data);

  // 6. Filter
  const filtered = allEnemyNations
    .filter(n => n.score >= minScore && n.score <= maxScore)
    .filter(n => !atWarWith.has(Number(n.id)))
    .filter(n => n.defensive_wars_count < 3)
    .filter(n => n.vacation_mode_turns === 0)
    .filter(n => n.beige_turns === 0);

  // 7. Load trade prices for resource valuation
  let prices: Prices | null = null;
  try {
    const row = db.prepare("SELECT data FROM trade_prices WHERE id = 1").get() as { data: string } | undefined;
    if (row) prices = JSON.parse(row.data) as Prices;
  } catch { /* use null */ }

  function attackLootValue(attacks: LootAttack[]): number {
    return attacks.reduce((sum, a) => {
      const rv = !prices ? 0
        : a.coal_looted * prices.coal + a.oil_looted * prices.oil + a.uranium_looted * prices.uranium
        + a.iron_looted * prices.iron + a.bauxite_looted * prices.bauxite + a.lead_looted * prices.lead
        + a.gasoline_looted * prices.gasoline + a.munitions_looted * prices.munitions
        + a.steel_looted * prices.steel + a.aluminum_looted * prices.aluminum + a.food_looted * prices.food;
      return sum + a.money_looted + rv;
    }, 0);
  }

  // 8. Fetch beige loot history
  const targetIds = filtered.map(n => Number(n.id));
  const targetIdSet = new Set(targetIds);
  const beigeMap = new Map<number, { loot: number; date: string; allLoots: number[] }>();

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
      if (w.date > existing.date) { existing.loot = loot; existing.date = w.date; }
    }
  }

  if (targetIds.length > 0) {
    try {
      const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const after = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 00:00:00`;
      for (let page = 1; ; page++) {
        const beigeData = await gql<{ wars: { data: BeigeWar[] } }>(BEIGE_WARS_QUERY, { ids: targetIds, after, page });
        for (const w of beigeData.wars.data) recordIfLoss(w);
        if (beigeData.wars.data.length < 500) break;
      }
    } catch (e) {
      console.error("[AiTargets] Beige loot query failed:", e instanceof Error ? e.message : e);
    }
  }

  // 9. Build target list and map
  const targets: TargetData[] = filtered.map(n => {
    const beige = beigeMap.get(Number(n.id));
    return {
      nation_id: Number(n.id),
      nation_name: n.nation_name,
      alliance_name: n.alliance?.name ?? "Unknown",
      avg_infra: n.cities.length > 0
        ? Math.round(n.cities.reduce((s, c) => s + c.infrastructure, 0) / n.cities.length)
        : 0,
      soldiers: n.soldiers,
      tanks: n.tanks,
      aircraft: n.aircraft,
      ships: n.ships,
      defensive_wars_count: n.defensive_wars_count,
      beige_avg: beige ? Math.round(beige.allLoots.reduce((s, v) => s + v, 0) / beige.allLoots.length) : null,
      beige_count: beige?.allLoots.length ?? null,
    };
  });

  const targetMap = new Map<number, TargetData>(targets.map(t => [t.nation_id, t]));

  // 10. Zero targets early exit
  if (targets.length === 0) {
    return NextResponse.json({
      damage_picks: [],
      loot_picks: [],
      summary: "No valid targets found in your score range.",
      target_count: 0,
    } satisfies AiTargetsResponse);
  }

  // 11. Call Ollama
  const N = Math.min(5, targets.length);
  const prompt = [
    `Here are ${targets.length} attackable enemy nations:`,
    JSON.stringify(targets.map(t => ({
      id: t.nation_id,
      nation_name: t.nation_name,
      alliance_name: t.alliance_name,
      avg_infra: t.avg_infra,
      soldiers: t.soldiers,
      tanks: t.tanks,
      aircraft: t.aircraft,
      ships: t.ships,
      defensive_wars_count: t.defensive_wars_count,
      beige_avg: t.beige_avg,
      beige_count: t.beige_count,
    }))),
    `Pick the ${N} best targets for (1) maximum infrastructure damage — favour high avg_infra and low military units, and (2) maximum loot — favour high beige_avg and low military resistance. Return JSON with keys "damage_picks", "loot_picks" (each an array of ${N} objects with "nation_id" and a one-sentence "reason"), and a "summary" string with overall strategic context.`,
  ].join("\n\n");

  let ollamaContent: string;
  try {
    const ollamaRes = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.5:397b-cloud",
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: "You are a war strategy advisor for the online game Politics and War. Analyze the provided list of attackable enemy nations and return JSON only — no other text." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!ollamaRes.ok) throw new Error(`Ollama HTTP ${ollamaRes.status}`);
    const ollamaJson = await ollamaRes.json();
    ollamaContent = ollamaJson?.message?.content ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetwork = msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("Ollama HTTP");
    return NextResponse.json(
      { error: isNetwork ? "AI service unavailable — is Ollama running?" : `AI error: ${msg}` },
      { status: 502 }
    );
  }

  // Strip <think> reasoning tokens if present
  if (ollamaContent.includes("<think>")) {
    ollamaContent = ollamaContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  let aiResult: { damage_picks: { nation_id: number; reason: string }[]; loot_picks: { nation_id: number; reason: string }[]; summary: string };
  try {
    aiResult = JSON.parse(ollamaContent);
    if (!Array.isArray(aiResult.damage_picks) || !Array.isArray(aiResult.loot_picks)) {
      throw new Error("Missing picks arrays");
    }
  } catch {
    return NextResponse.json(
      { error: "AI returned an unexpected response — try again" },
      { status: 502 }
    );
  }

  // 12. Enrich picks with full target stats
  function enrichPicks(picks: { nation_id: number; reason: string }[]): AiPick[] {
    return picks
      .map(p => {
        const t = targetMap.get(Number(p.nation_id));
        if (!t) return null;
        return { ...t, reason: p.reason };
      })
      .filter((p): p is AiPick => p !== null);
  }

  return NextResponse.json({
    damage_picks: enrichPicks(aiResult.damage_picks),
    loot_picks: enrichPicks(aiResult.loot_picks),
    summary: aiResult.summary ?? "",
    target_count: targets.length,
  } satisfies AiTargetsResponse);
}
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error|Error|aiTargets"
```

Expected: no errors, `├ ƒ /api/aiTargets` in the output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/aiTargets.ts src/app/api/aiTargets/route.ts
git commit -m "feat: add /api/aiTargets route with Ollama integration"
```

---

## Chunk 2: Page

### Task 2: Create `/ai-targets/page.tsx`

**Files:**
- Create: `src/app/ai-targets/page.tsx`

- [ ] **Step 1: Write the page component**

```typescript
// src/app/ai-targets/page.tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Brain, Swords, Coins, RefreshCw } from "lucide-react";
import type { AiTargetsResponse, AiPick } from "@/lib/aiTargets";

interface Me {
  discordId: string;
  username: string;
}

function fmt$(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function PickCard({
  picks,
  title,
  accent,
  statLabel,
  statValue,
}: {
  picks: AiPick[];
  title: string;
  accent: string;
  statLabel: string;
  statValue: (p: AiPick) => string;
}) {
  return (
    <div className={`rounded-xl border bg-[#161b2e] p-5 space-y-4 ${accent}`}>
      <h2 className="font-bold text-sm text-white">{title}</h2>
      <div className="space-y-3">
        {picks.map((pick, i) => (
          <div key={pick.nation_id} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-[#2a3150] flex items-center justify-center text-xs font-bold text-slate-300">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <a
                  href={`https://politicsandwar.com/nation/id=${pick.nation_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-white hover:underline text-sm"
                >
                  {pick.nation_name}
                </a>
                <span className="text-xs text-slate-500">{pick.alliance_name}</span>
                <span className="text-xs font-mono text-slate-400 ml-auto">{statLabel}: {statValue(pick)}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{pick.reason}</p>
            </div>
          </div>
        ))}
        {picks.length === 0 && (
          <p className="text-sm text-slate-500 italic">No picks available.</p>
        )}
      </div>
    </div>
  );
}

export default function AiTargetsPage() {
  const [triggered, setTriggered] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  const { data: me, isLoading: meLoading } = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then(r => r.ok ? r.json() : null),
    retry: false,
    staleTime: Infinity,
  });

  const {
    data,
    isLoading: analysisLoading,
    error,
    refetch,
  } = useQuery<AiTargetsResponse>({
    queryKey: ["aiTargets", fetchKey],
    queryFn: async () => {
      const res = await fetch("/api/aiTargets");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server error (${res.status})`);
      }
      return res.json();
    },
    enabled: triggered,
    retry: false,
    staleTime: Infinity,
  });

  function handleAnalyze() {
    if (!triggered) {
      setTriggered(true);
    } else {
      setFetchKey(k => k + 1);
      refetch();
    }
  }

  if (meLoading) {
    return <AppShell><LoadingSpinner /></AppShell>;
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Brain size={20} className="text-purple-400" />
              AI Target Analysis
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              AI-powered picks for maximum damage and maximum loot.
            </p>
          </div>
          {data && (
            <button
              onClick={handleAnalyze}
              disabled={analysisLoading}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 border border-[#2a3150] hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} className={analysisLoading ? "animate-spin" : ""} />
              Re-analyze
            </button>
          )}
        </div>

        {!me && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center space-y-3">
            <Brain size={32} className="text-slate-600 mx-auto" />
            <p className="text-slate-400 text-sm">Log in with Discord to use AI targeting.</p>
            <a
              href="/login"
              className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Login with Discord
            </a>
          </div>
        )}

        {me && !triggered && !data && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center space-y-3">
            <Brain size={32} className="text-purple-400 mx-auto" />
            <p className="text-slate-400 text-sm">
              Fetches all valid targets in your score range and asks AI to pick the best 5 for damage and loot.
              Takes about a minute.
            </p>
            <button
              onClick={handleAnalyze}
              className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-colors"
            >
              Analyze Targets
            </button>
          </div>
        )}

        {analysisLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-10 h-10 border-4 border-[#2a3150] border-t-purple-500 rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Analyzing targets… this may take a minute</p>
          </div>
        )}

        {error && !analysisLoading && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 space-y-2">
            <p className="text-red-400 text-sm">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              onClick={handleAnalyze}
              className="text-xs text-red-400 hover:text-red-300 underline"
            >
              Try again
            </button>
          </div>
        )}

        {data && !analysisLoading && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <PickCard
                picks={data.damage_picks}
                title="⚔ Max Damage"
                accent="border-red-500/30"
                statLabel="Avg Infra"
                statValue={p => p.avg_infra.toLocaleString()}
              />
              <PickCard
                picks={data.loot_picks}
                title="💰 Max Loot"
                accent="border-amber-500/30"
                statLabel="Avg Beige Loot"
                statValue={p => p.beige_avg != null ? fmt$(p.beige_avg) : "No beige history"}
              />
            </div>

            {data.summary && (
              <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">AI Summary</p>
                <p className="text-slate-400 text-sm leading-relaxed">{data.summary}</p>
              </div>
            )}

            <p className="text-xs text-slate-600 text-center">
              Analyzed {data.target_count} valid target{data.target_count !== 1 ? "s" : ""}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Check `Coins` icon exists in lucide-react (used in imports above — but actually only `Brain`, `Swords`, `Coins`, `RefreshCw` are imported; verify they're all available)**

```bash
node -e "const l = require('./node_modules/lucide-react'); console.log('Brain:', !!l.Brain, 'RefreshCw:', !!l.RefreshCw, 'Coins:', !!l.Coins)"
```

If `Coins` is missing, replace with `DollarSign` (already used in Sidebar).

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error|Error|ai-targets"
```

Expected: no errors, `├ ○ /ai-targets` in the output.

- [ ] **Step 4: Commit**

```bash
git add src/app/ai-targets/page.tsx
git commit -m "feat: add /ai-targets page with AI-powered target analysis"
```

---

## Chunk 3: Wiring

### Task 3: Sidebar, role-config, and ALL_PAGES

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/app/role-config/page.tsx`
- Modify: `data/role-config.json`

- [ ] **Step 1: Add `Brain` to Sidebar imports and add the nav entry**

In `src/components/Sidebar.tsx`:

1. Add `Brain` to the lucide-react import line.
2. Add to `hiddenNav` after the `beige-watch` entry:
   ```typescript
   { label: "AI Targets", href: "/ai-targets", icon: Brain },
   ```

- [ ] **Step 2: Add `/ai-targets` to ALL_PAGES in role-config page**

In `src/app/role-config/page.tsx`, add `"/ai-targets"` to the `ALL_PAGES` array.

- [ ] **Step 3: Add `/ai-targets` to role-config.json**

In `data/role-config.json`, add an entry for `/ai-targets` with the same role IDs as `/command-center`:

```json
"/ai-targets": [
  "1084632591929454672",
  "1399051515393740900",
  "679514139424849920",
  "730796352644317294",
  "817219304222097420"
]
```

Add it after the `/beige-watch` entry.

- [ ] **Step 4: Build to verify everything compiles**

```bash
npm run build 2>&1 | grep -E "error|Error|ai-targets|Brain"
```

Expected: clean build, `├ ○ /ai-targets` present.

- [ ] **Step 5: Restart server and smoke-test**

```bash
kill -9 $(ss -tlnp | grep ':3000' | grep -oP 'pid=\K[0-9]+') 2>/dev/null
sleep 1
nohup npm run start > /tmp/nextjs.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ai-targets
```

Expected: `200`

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/app/role-config/page.tsx data/role-config.json
git commit -m "feat: wire /ai-targets into sidebar and role-config"
```
