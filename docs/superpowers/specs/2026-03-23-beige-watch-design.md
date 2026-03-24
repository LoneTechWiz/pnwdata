# Beige Watch Page — Design Spec

## Overview

A page at `/beige-watch` that shows enemy nations currently on beige, sorted by turns remaining so members can identify high-priority targets leaving beige soon. Optionally filtered to your score range when a nation ID is provided. Includes the same beige loot history columns as War Targets.

## Route & Navigation

- **Route:** `/beige-watch`
- **Placement:** Added to `hiddenNav` array in `src/components/Sidebar.tsx` (requires login)
- **Icon:** `ShieldOff` from lucide-react
- **Label:** "Beige Watch"

## Data Source

A new live API route `/api/beigeWatch` calls the PnW GraphQL API on each request. Enemy nations are not stored in the local SQLite DB, so live fetching is required. Uses `data/war-config.json` for `enemy_alliance_ids`, identical to `/api/warTargets`.

## API Route — `/api/beigeWatch`

**File:** `src/app/api/beigeWatch/route.ts`

`GET /api/beigeWatch?nationId=<optional>`

### Behavior

1. Read `data/war-config.json` for `enemy_alliance_ids`; return 500 if missing/invalid
2. Fetch all enemy alliance members via `ENEMY_MEMBERS_QUERY` (same query as war targets, using `allSettled` for resilience)
3. Filter to nations with `beige_turns > 0`
4. If `nationId` provided:
   - Fetch your nation score via `NATION_SCORE_QUERY`
   - Compute `minScore = floor(score * 0.75)`, `maxScore = ceil(score * 4/3)`
   - Add `inRange: boolean` to each nation result
5. Run beige loot pagination (last 90 days, same logic as war targets) against the filtered nation IDs
6. Return response

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
  yourScore?: number;
  minScore?: number;
  maxScore?: number;
  yourLeader?: string;
  yourDiscord?: string | null;
}
```

## Page — `/beige-watch`

**File:** `src/app/beige-watch/page.tsx`

### Layout

```
[Header: "Beige Watch" + ShieldOff icon + subtitle]

[Inputs bar]
  Nation ID (optional)  |  Max Beige Turns  |  Min Cities  |  Max Cities  |  [Load] button

[Score range banner — shown only when nationId provided]
  Score: X → Attack range: Y – Z   (N nations shown)

[Table or empty state]
```

### Inputs Bar

| Input | Type | Default | Behavior |
|-------|------|---------|----------|
| Nation ID | number | empty | Optional; enables score range filtering and in-range indicators |
| Max Beige Turns | number | empty (no filter) | Client-side filter; hides nations with `beige_turns >` this value |
| Min Cities | number | empty | Client-side filter |
| Max Cities | number | empty | Client-side filter |

The Load button fetches from `/api/beigeWatch`. Filters are applied client-side after data loads. The page auto-fetches on mount with no nationId (shows all beige nations immediately).

### Auto-load on Mount

On mount, fetch all beige nations with no nationId. This gives immediate value without requiring any input. If a `nationId` query param is in the URL, pre-populate the input and include it in the initial fetch.

### Table Columns

| Column | Key | Notes |
|--------|-----|-------|
| — | War button | Declare war link; `https://politicsandwar.com/nation/war/declare/id=<id>` |
| Nation | `nation_name` | Link to nation page |
| Alliance | `alliance_name` | |
| Beige Turns | `beige_turns` | Color-coded: ≤6 turns = red/orange (urgent), >6 = amber |
| In Range | `inRange` | Green dot = yes, gray dot = no; hidden column when no nationId entered |
| Score | `score` | |
| Cities | `num_cities` | |
| Avg Infra | `avg_infra` | |
| Soldiers | `soldiers` | |
| Tanks | `tanks` | |
| Aircraft | `aircraft` | |
| Ships | `ships` | |
| Off Wars | `offensive_wars_count` | |
| Def Wars | `defensive_wars_count` | Orange if ≥ 3 (fully slotted) |
| Beige Loot | `beige_loot` | Last beige loot value + date |
| Avg Beige | `beige_avg` | Avg loot + war count |

**Default sort:** `beige_turns` ascending (most urgent first).

### States

- **Loading:** centered `LoadingSpinner`
- **Error:** red error banner with message
- **Empty:** centered empty state with icon — "No beige nations found" with subtitle explaining filters
- **Results:** sortable table

### Hooks Rules

All `useMemo` calls (filtered + sorted list) must come **before** any conditional early returns, per the existing codebase convention.

## Styling

Follows existing dark theme conventions:
- Background: `#0f1117`, cards: `#161b2e`, borders: `#2a3150`
- Beige turns urgency colors: ≤6 turns `text-red-400`, >6 turns `text-amber-400`
- In-range dot: `bg-green-500` (in range) / `bg-slate-600` (out of range)
- Defensive wars ≥ 3: `text-orange-400` (matches war targets)
