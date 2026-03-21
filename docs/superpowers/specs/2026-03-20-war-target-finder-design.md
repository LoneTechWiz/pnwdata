# War Target Finder — Design Spec

**Date:** 2026-03-20
**Status:** Approved

---

## Overview

A new page (`/war-targets`) that lets a player enter their nation ID and instantly see a ranked list of attackable nations from enemy alliances, with infra and military stats displayed. Enemy alliance IDs are stored in a server-side config file maintained by an admin. Active offensive wars are fetched live from the PnW API to automatically exclude already-targeted nations.

---

## Config File

**Path:** `data/war-config.json`

```json
{
  "enemy_alliance_ids": [123, 456]
}
```

- Admin edits this file manually when the war situation changes.
- Values are stored as integers. At runtime, each must be coerced with `Number()` before use as `[Int]` in GraphQL variables (per the PnW API behavior where `alliance_id` returns as string).
- The file is excluded from git (alongside `data/pnw.db`).
- If the file is missing or `enemy_alliance_ids` is empty, the API route returns a clear error message.
- Maximum of 10 `enemy_alliance_ids` enforced at the API route (returns 400 if exceeded).

---

## API Route

**Endpoint:** `GET /api/warTargets?nationId=<id>`

**Server-side logic (all API calls use `PNW_API_KEY`, 30s timeout per call):**

1. Validate `nationId` query param: must be present, numeric, and a positive integer. Return HTTP 400 with a descriptive message before making any external calls if invalid.
2. Read `data/war-config.json` to get `enemy_alliance_ids`. Validate: file exists, array non-empty, ≤10 entries.
2. Fetch in parallel:
   - Your nation's score: `nations(id:[<id>]) { data { score } }`
   - Your active offensive wars: `wars(att_id:[<id>], active:true) { data { def_id } }` — use the proven top-level `wars()` resolver (same pattern as `sync.ts`), not a nested `offensive_wars` subquery.
   - All members of each enemy alliance: one `nations(alliance_id:[<allianceId>], first:500)` query per alliance (parallel). **Known limitation:** results are capped at 500 members per alliance; targets beyond that may be missed. Accepted constraint.
3. Compute score range: `floor(yourScore * 0.75)` to `ceil(yourScore * 4 / 3)` (exact fraction, not `1.333`).
4. Filter enemy nations to those within score range.
5. Exclude nations whose IDs appear in your active offensive wars.
6. For each remaining nation, compute and include:
   - `id`, `nation_name`, `leader_name`, `alliance_name` (from nested `alliance { name }` — see query below), `score`, `num_cities`
   - `avg_infra` — `cities.length > 0 ? avg(cities[].infrastructure) : 0`
   - `soldiers`, `tanks`, `aircraft`, `ships`
   - `defensive_wars_count` — number of current defensive wars (0–3)
   - `vacation_mode_turns` — to flag VM nations
   - `beige_turns` — to flag beige nations
7. Sort by `avg_infra` descending.
8. Return JSON array plus `{ yourScore, minScore, maxScore }` metadata.

**GraphQL queries:**

```graphql
# Your nation score
nations(id:[<id>]) { data { score } }

# Your active offensive wars (top-level resolver, proven pattern)
wars(att_id:[<id>], active:true) { data { def_id } }

# Enemy alliance members (run once per alliance_id, parallel)
nations(alliance_id:[<allianceId>], first:500) {
  data {
    id nation_name leader_name score num_cities
    alliance { name }
    cities { infrastructure }
    soldiers tanks aircraft ships
    defensive_wars_count vacation_mode_turns beige_turns
  }
}
```

---

## Page UI (`/war-targets`)

**Route:** `src/app/war-targets/page.tsx`

**Note:** This page uses `useState` + manual fetch triggered by button click, not `useQuery` with `refetchInterval`, because the query is parameterized by user input and is not a background-polling dashboard widget.

### Input Section
- Single number input: **"Your Nation ID"** (stored in local React state)
- **"Find Targets"** button — triggers `fetch('/api/warTargets?nationId=<id>')`
- Score range banner appears after first successful fetch: e.g. `"Score: 4,250 → Attack range: 3,187 – 5,667"`

### Results Table
Columns (sortable by clicking header, chevron icons):
| Column | Default Sort |
|--------|-------------|
| Nation (linked to PnW) | — |
| Leader | — |
| Alliance | — |
| Score | — |
| Cities | — |
| Avg Infra | ↓ desc (default) |
| Soldiers | — |
| Tanks | — |
| Aircraft | — |
| Ships | — |
| Def Wars | — |
| Status | — |

### Badges / Status
- **Slotted** (orange) — `defensive_wars_count >= 3`
- **Beige** (yellow) — `beige_turns > 0`
- **VM** (gray) — `vacation_mode_turns > 0`

Nations can have multiple badges (e.g., Beige + Slotted).

### States
- **Empty:** prompt to enter nation ID and click Find Targets
- **Loading:** spinner while API fetches
- **Error:** inline error message (e.g. "war-config.json not found or empty", "Nation not found", PnW API error)
- **No results:** "No attackable targets found in your score range"

---

## Sidebar Nav

Add to `src/components/Sidebar.tsx`:
```ts
{ label: "War Targets", href: "/war-targets", icon: Crosshair }
```
`Crosshair` is available in `lucide-react` and is visually distinct from `Target` (used for MMR Checker).

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `data/war-config.json` | Create (admin-maintained; already git-ignored via the `data/` rule in `.gitignore`) |
| `src/app/api/warTargets/route.ts` | Create |
| `src/app/war-targets/page.tsx` | Create |
| `src/components/Sidebar.tsx` | Modify — add nav entry |

---

## Out of Scope

- Saving nation ID between sessions (no localStorage, no DB)
- Showing loot estimates
- Filtering by military type
- Multi-player / per-member target assignments
- Pagination beyond 500 members per enemy alliance
