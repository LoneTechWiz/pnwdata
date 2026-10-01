# Command Center Page — Design Spec

## Overview

A hidden, password-protected page at `/command-center` that replicates the "Command Center" tab from the BK Milcom Google Sheet. It shows a per-nation war dashboard: select any alliance member from a dropdown, and see all their active wars with full military context for both sides.

## Route & Navigation

- **Route:** `/command-center`
- **Placement:** Added to `hiddenNav` array in `src/components/Sidebar.tsx` (password-protected, not visible by default)
- **Icon:** `Radio` from lucide-react (distinct from `Swords` already used for "Wars" and "Need to Declare")
- **Label:** "Command Center"

## Data Sources

Three `useQuery` calls, all with `refetchInterval: 10 * 60 * 1000`:
- `fetchMembers()` — for the nation dropdown and the selected nation's live military stats
- `fetchWars()` — for the wars table
- `fetchSyncStatus()` — for the sync timestamp in the header and the `SyncingPlaceholder` condition (use `refetchInterval: 15_000`, matching other pages)

## UI Layout

### Header
- Page title: **"BLACK KNIGHTS COMMAND CENTER"** (styled prominently)
- Sync timestamp line: "Last synced: <time>" using `status.last_synced_at`, matching the pattern used in other pages

### Nation Selector
- A `<select>` dropdown listing all non-VM (`vacation_mode_turns === 0`) members
- Each option displays: `"NationName (LeaderName)"`
- Sorted alphabetically by `nation_name`
- State: `useState<number | null>(null)` — `null` when members haven't loaded yet
- On first data load, auto-select the first member's `id` via a `useEffect` (only if current value is `null`)
- No table is rendered while `selectedId === null`

### Loading / Error / Syncing States
- `isLoading` (members or wars) → `<LoadingSpinner />`
- `error` → `<ErrorMessage />`
- `members.length === 0 && (status?.status === "never" || status?.status === "syncing")` → `<SyncingPlaceholder />` (matches established pattern across all list pages)

### Wars Table

Filtered from `fetchWars()` where `war.att_id === selectedNation.id || war.def_id === selectedNation.id`.

**Per-row derived values:**
```
isAttacker   = war.att_id === selectedNation.id
opponent     = isAttacker ? war.defender : war.attacker
opponentId   = isAttacker ? war.def_id : war.att_id
bkRes        = isAttacker ? war.att_resistance : war.def_resistance
oppRes       = isAttacker ? war.def_resistance : war.att_resistance
ourPts       = isAttacker ? war.att_points : war.def_points
theirPts     = isAttacker ? war.def_points : war.att_points
offDef       = isAttacker ? "Offense" : "Defense"
warType      = war.war_type  // "RAID" | "ATTRITION" | "ORDINARY"
```

**Columns (in order):**

| Column | Source | Notes |
|--------|--------|-------|
| Opponent | `opponent?.nation_name ?? \`Nation #${opponentId}\`` | Linked to `https://politicsandwar.com/nation/id=${opponentId}` |
| BK Res | `bkRes` | Pink cell background when `bkRes < oppRes` |
| Opp Res | `oppRes` | — |
| Our Pts | `ourPts` | Pink cell background when `ourPts === 0` |
| Their Pts | `theirPts` | — |
| BK Sol | `selectedNation.soldiers` | Live from latest sync; same value across all rows |
| BK Tank | `selectedNation.tanks` | Same value across all rows |
| BK Air | `selectedNation.aircraft` | Same value across all rows |
| BK Ship | `selectedNation.ships` | Same value across all rows |
| Opp Sol | `opponent?.soldiers ?? 0` | Snapshotted at war declaration time (not live) |
| Opp Tank | `opponent?.tanks ?? 0` | Same caveat |
| Opp Air | `opponent?.aircraft ?? 0` | Same caveat |
| Opp Ship | `opponent?.ships ?? 0` | Same caveat |
| Off/Def | `offDef` | — |
| War Type | `warType` | — |

> **Note:** Opponent military stats (`opponent.soldiers` etc.) come from the embedded `attacker`/`defender` snapshot in the War record — these reflect troop levels at war declaration, not current. BK military stats come from the live `Nation` object and are current.

**Color highlighting (matching the sheet):**
- `bkRes < oppRes` → pink background on the **BK Res** cell
- `ourPts === 0` → pink background on the **Our Pts** cell

**Empty state:** If the selected nation has no active wars, show a centered "No active wars" message inside the table area.

**No export button** — this page is a situational command view, not a data export page.

## Component Structure

Single file: `src/app/command-center/page.tsx`

- `"use client"` page
- All `useMemo`/`useEffect`/`useState` calls before any conditional early returns (Rules of Hooks)
- Uses `AppShell` wrapper
- Uses `LoadingSpinner`, `ErrorMessage`, `SyncingPlaceholder` consistent with other pages

## Styling

Follows the established dark theme:
- Background: `#0f1117`, cards: `#161b2e`, borders: `#2a3150`
- Pink highlight cells: `bg-pink-900/40` (or `bg-red-900/30` to match existing danger colors)
- Table structure matches other pages: `rounded-xl border border-[#2a3150]`, `thead bg-[#161b2e]`, `tbody divide-y divide-[#2a3150]`
- Select dropdown: `bg-[#0f1117] border border-[#2a3150] rounded-lg text-white` matching other inputs in the app
