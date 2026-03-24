# Beige Watch Page — Design Spec

## Overview

A page at `/beige-watch` that shows enemy nations currently on beige, sorted by turns remaining so members can identify high-priority targets leaving beige soon. Optionally filtered to your score range when a nation ID is provided. Includes the same beige loot history columns as War Targets.

## Route & Navigation

- **Route:** `/beige-watch`
- **Placement:** Added to `hiddenNav` array in `src/components/Sidebar.tsx` (requires login)
- **Icon:** `ShieldOff` from lucide-react — must be added to the `Sidebar.tsx` import alongside the existing icon imports
- **Label:** "Beige Watch"

## Data Source

A new live API route `/api/beigeWatch` calls the PnW GraphQL API on each request. Enemy nations are not stored in the local SQLite DB, so live fetching is required. Uses `data/war-config.json` for `enemy_alliance_ids`, identical to `/api/warTargets`.

## API Route — `/api/beigeWatch`

**File:** `src/app/api/beigeWatch/route.ts`

Must include `export const dynamic = "force-dynamic"` to prevent Next.js from statically caching the live-data route.

`GET /api/beigeWatch?nationId=<optional>`

### Behavior

**Step 1 — API key guard:** Return 500 if `process.env.PNW_API_KEY` is absent (same guard as all other live-data routes).

**Step 2 — Config:** Read `data/war-config.json` for `enemy_alliance_ids`; return 500 if missing/invalid.

**Step 3 — Alliance members:** Fetch all enemy alliance members via `ENEMY_MEMBERS_QUERY` using `Promise.allSettled` (same resilience pattern as war targets). If all queries fail, return 502. Filter results to nations with `beige_turns > 0`. No further server-side filtering — all beige nations are returned regardless of VM status, war slot count, or score.

**Step 4 — Score range (only if `nationId` provided):** If a valid `nationId` is in the query string, fetch the nation's score via `NATION_SCORE_QUERY`. Compute `minScore = floor(score * 0.75)`, `maxScore = ceil(score * 4/3)`. Set `inRange = score >= minScore && score <= maxScore` on each nation. If no `nationId` is provided, skip this step entirely and set `inRange: null` for all nations.

**Step 5 — Beige loot:** Run beige loot pagination using all nation IDs from Step 3 (all enemy beige nations). Load trade prices from SQLite (`trade_prices` table, same as war targets) for resource valuation in loot calculations — requires importing `db` from `@/lib/db`. Use the same `BEIGE_WARS_QUERY` logic as war targets (last 90 days). The loop fetches pages 1 through 5: after fetching each page, break if `wars.length < 500` (short page, no more results) **or** if `page >= 5` (5 pages fetched, cap reached — the break fires after page 5 is processed). Older war history beyond page 5 is silently omitted. Build the loot map identically to war targets (most recent loss per nation, all-time average).

**Step 6 — Return response.**

### Response Shape

```ts
interface BeigeNation {
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
  inRange: boolean | null;  // null when no nationId provided
  beige_loot: number | null;
  beige_date: string | null;
  beige_avg: number | null;
  beige_count: number | null;
}

interface BeigeWatchResponse {
  nations: BeigeNation[];
  yourScore?: number;          // present only when nationId provided
  minScore?: number;           // present only when nationId provided
  maxScore?: number;           // present only when nationId provided
  yourLeader?: string;         // present only when nationId provided
  yourDiscord?: string | null; // present only when nationId provided
}
```

## Page — `/beige-watch`

**File:** `src/app/beige-watch/page.tsx`

### Layout

```
[Header: "Beige Watch" + ShieldOff icon + subtitle]

[Inputs bar]
  Nation ID (optional) + leader/discord display  |  Max Beige Turns  |  Min Cities  |  Max Cities  |  [Load] button

[Score range banner — shown only when result.yourScore is present]
  Score: X → Attack range: Y – Z   (N nations shown, N = displayedNations.length)

[Table or empty state]
```

### Inputs Bar

| Input | Type | Default | Behavior |
|-------|------|---------|----------|
| Nation ID | number | empty | Optional; enables score range filtering and in-range indicators |
| Max Beige Turns | number | empty (no filter) | Client-side filter |
| Min Cities | number | empty | Client-side filter |
| Max Cities | number | empty | Client-side filter |

When `result.yourLeader` is present, display it inline next to the Nation ID label (same pattern as war targets: `result.yourLeader` + optional `result.yourDiscord` in muted text).

**Load button:** disabled only while `loading` — never disabled due to an empty nation ID input, because fetching with no ID is valid (returns all beige nations).

### Mount Behavior

A single `useEffect` on mount:
- If a `nationId` query param is present in the URL: pre-populate the Nation ID input with that value, then fetch `/api/beigeWatch?nationId=<value>`
- Otherwise: fetch `/api/beigeWatch` with no nationId

Only one fetch fires on mount.

### Client-Side Filtering and Sorting

A single `useMemo` (named `displayedNations`) applies filters then sort in sequence:

1. Start from `result.nations`
2. Apply max beige turns filter (if set)
3. Apply min cities filter (if set)
4. Apply max cities filter (if set)
5. Sort by `sortKey` / `sortDir`

The banner's nation count ("N nations shown") references `displayedNations.length`, not `result.nations.length`.

**Sort coercion for `inRange`:** The generic comparator (`(av as number) - (bv as number)`) must not be used for `inRange` — `null` values produce `NaN`. Instead, `inRange` must be special-cased before the generic branch: coerce `true → 1`, `false → 0`, `null → -1`, then compare numerically. All other non-string fields fall through to the generic comparator as in war targets.

This `useMemo` call must appear before any conditional early returns (Rules of Hooks).

### Table Columns

The `COLUMNS` array always includes the `inRange` entry. The `inRange` column header and cells are rendered conditionally inside the `COLUMNS.map()` loop — skip rendering the `<th>` and `<td>` for `inRange` when `!result?.yourScore`. The `handleSort("inRange")` path remains valid via the sort state; it only becomes reachable when the column is visible. The column is sortable when visible.

| Column | Key | Notes |
|--------|-----|-------|
| — | War button | Declare war link |
| Nation | `nation_name` | Link to nation page |
| Alliance | `alliance_name` | |
| Beige Turns | `beige_turns` | ≤6 turns `text-red-400`, >6 turns `text-amber-400` |
| In Range | `inRange` | Conditionally rendered; green dot = in range, gray dot = out of range |
| Score | `score` | |
| Cities | `num_cities` | |
| Avg Infra | `avg_infra` | |
| Soldiers | `soldiers` | |
| Tanks | `tanks` | |
| Aircraft | `aircraft` | |
| Ships | `ships` | |
| Off Wars | `offensive_wars_count` | |
| Def Wars | `defensive_wars_count` | `text-orange-400` if ≥ 3 |
| Beige Loot | `beige_loot` | Last beige loot value + date |
| Avg Beige | `beige_avg` | Avg loot + war count |

**Default sort:** `beige_turns` ascending. When the user clicks a different column, the sort direction defaults to `desc` (matching war targets behavior). Re-fetching (Load button) preserves user-set sort key and direction.

### States

- **Initial (before mount fetch resolves):** `loading` is set to `true` immediately; the `LoadingSpinner` is shown — there is no blank/idle state
- **Loading:** centered `LoadingSpinner`
- **Error:** red error banner with message
- **No beige nations (server):** `result.nations.length === 0` — empty state icon + "No nations are currently on beige"
- **No results after filters:** `displayedNations.length === 0` but `result.nations.length > 0` — empty state icon + "No nations match your filters"
- **Results:** sortable table

When `result` is present but `result.yourLeader` is absent (i.e., initial auto-load with no nationId), the leader/discord display area is not rendered.

## Styling

Follows existing dark theme conventions:
- Background: `#0f1117`, cards: `#161b2e`, borders: `#2a3150`
- Beige turns urgency: ≤6 turns `text-red-400`, >6 turns `text-amber-400`
- In-range dot: `bg-green-500` (in range) / `bg-slate-600` (out of range)
- Defensive wars ≥ 3: `text-orange-400` (matches war targets)
