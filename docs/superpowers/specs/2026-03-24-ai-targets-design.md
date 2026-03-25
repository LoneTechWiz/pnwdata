# AI Targets Page — Design Spec

**Date:** 2026-03-24

## Overview

A new member-only page (`/ai-targets`) that fetches all valid war targets for the logged-in nation, sends them to a local Ollama instance, and displays the AI's top 5 picks for maximum infra damage and maximum loot. Each list may have fewer than 5 entries if fewer valid targets exist.

## Architecture

### API Route — `/api/aiTargets`

A single self-contained Next.js route (`src/app/api/aiTargets/route.ts`). No shared code with `/api/warTargets` — the GraphQL query strings and filter logic are intentionally duplicated. If those queries change in `warTargets`, update `aiTargets` manually.

**Request:** `GET /api/aiTargets` — no query params; nation identity comes from the session cookie + SQLite lookup.

**Steps:**

1. Call `getSession()` (no arguments — uses `next/headers`, same pattern as `/api/auth/me`). Return 401 if null.
2. Look up nation from SQLite using `session.username`. Must check both `nations` and `applicants` tables (applicant nations are excluded from `nations` per sync logic):
   ```sql
   SELECT id FROM nations WHERE LOWER(json_extract(data, '$.discord')) = LOWER(?)
   UNION
   SELECT id FROM applicants WHERE LOWER(json_extract(data, '$.discord')) = LOWER(?)
   LIMIT 1
   ```
   Return 404 with "Your Discord username isn't linked to a PnW nation. Make sure your in-game Discord field matches your Discord username." if no row found.
3. Fetch from PnW GraphQL (30-second timeout per request, same as `warTargets`):
   - Nation score + active offensive wars
   - All enemy alliance members (from `war-config.json` `enemy_alliance_ids`)
   - Beige loot history for in-range targets (90-day paginated query)
4. Filter targets: score in range (75%–133%), not already at war with you, fewer than 3 defensive wars, not in vacation mode, not on beige.
5. Build a target map: `Map<number, TargetData>` keyed by `nation_id` from the filtered list — used in step 9 to enrich AI picks.
6. If zero valid targets exist, return `{ damage_picks: [], loot_picks: [], summary: "No valid targets found in your score range.", target_count: 0 }` without calling Ollama.
7. Build prompt (see below) and POST to `http://localhost:11434/api/chat` with:
   - `model: "qwen3.5:397b-cloud"` — exact model tag in the user's local Ollama instance; do not change it
   - `stream: false`
   - `format: "json"`
   - fetch timeout: 120 seconds
8. Extract `message.content` from the Ollama response. If the content starts with `<think>` (qwen3 reasoning tokens that may leak through), strip everything up to and including the closing `</think>` tag before parsing. Parse as JSON. Return 502 with "AI service unavailable — is Ollama running?" on network error, or "AI returned an unexpected response — try again" on parse failure.
9. Enrich each AI pick by joining `nation_id` against the target map from step 5, adding: `avg_infra`, `beige_avg`, `beige_count`, `soldiers`, `tanks`, `aircraft`, `ships`, `defensive_wars_count`, `alliance_name`.
10. Return the enriched response.

**Response shape:**

```json
{
  "damage_picks": [
    {
      "nation_id": 123,
      "nation_name": "Foo",
      "alliance_name": "Bar",
      "avg_infra": 2400,
      "soldiers": 8000,
      "tanks": 200,
      "aircraft": 45,
      "ships": 2,
      "defensive_wars_count": 0,
      "reason": "High avg infra with minimal military resistance."
    }
  ],
  "loot_picks": [
    {
      "nation_id": 456,
      "nation_name": "Baz",
      "alliance_name": "Qux",
      "beige_avg": 180000000,
      "beige_count": 3,
      "soldiers": 5000,
      "tanks": 100,
      "aircraft": 30,
      "ships": 1,
      "defensive_wars_count": 1,
      "reason": "Consistent beige loot history averaging $180M across 3 wars."
    }
  ],
  "summary": "One paragraph of overall strategic context from the AI.",
  "target_count": 47
}
```

`target_count` is the post-filter count of valid targets passed to the AI. Each picks array may have fewer than 5 entries; the UI renders however many are returned.

The same nation may appear in both `damage_picks` and `loot_picks` — no deduplication.

### Ollama Prompt

System message:
> "You are a war strategy advisor for the online game Politics and War. Analyze the provided list of attackable enemy nations and return JSON only — no other text."

User message: a compact JSON array of all valid targets, each with `id`, `nation_name`, `alliance_name`, `avg_infra`, `soldiers`, `tanks`, `aircraft`, `ships`, `defensive_wars_count`, `beige_avg` (dollars, null if no history), `beige_count`.

Followed by (where `N = Math.min(5, targets.length)`):
> "Pick the {N} best targets for (1) maximum infrastructure damage — favour high avg_infra and low military units, and (2) maximum loot — favour high beige_avg and low military resistance. Return JSON with keys `damage_picks`, `loot_picks` (each an array of up to {N} objects with `nation_id` and a one-sentence `reason`), and a `summary` string with overall strategic context."

### Page — `/ai-targets`

**File:** `src/app/ai-targets/page.tsx` — `"use client"` component.

**Nation detection:** Fetch `/api/auth/me` on mount to check login state. The nation lookup is server-side in the API route — no nation ID input on the page.

**States:**

| State | UI |
|---|---|
| Not logged in (`me` is null) | "Log in with Discord to use AI targeting." + login link |
| Idle | "Analyze Targets" button |
| Loading | Spinner: "Analyzing targets… this may take a minute" |
| Error | Red error box with message from API + retry button |
| Success | Two cards + summary |

Nation-not-linked surfaces as an Error state with the 404 message.

Zero-targets surfaces as Success state showing only the summary paragraph and "Analyzed 0 valid targets" — no cards rendered.

**Results layout:**

- Two cards side by side on desktop (`md:grid-cols-2`), stacked on mobile
- **Max Damage card** (red accent, `border-red-500/30`): each pick shows rank badge, nation name linked to `https://politicsandwar.com/nation/id=X`, alliance name, avg infra, AI reason
- **Max Loot card** (amber accent, `border-amber-500/30`): same layout, shows avg beige loot; if `beige_avg` is null show "No beige history" in muted text
- Below both cards: AI `summary` paragraph in `text-slate-400`
- "Re-analyze" button + "Analyzed N valid targets" note

### Sidebar & Access Control

- Add "AI Targets" to `hiddenNav` in `Sidebar.tsx`, after the `beige-watch` entry (bottom of the Military & War comment group). Use the `Brain` icon from `lucide-react` (confirmed available).
- Add `/ai-targets` to `data/role-config.json` — copy the role ID array from the `/command-center` entry.
- Add `/ai-targets` to `ALL_PAGES` in `src/app/role-config/page.tsx`.

## Error Handling

| Failure | Behaviour |
|---|---|
| Not authenticated | 401 — page shows login prompt |
| Discord not linked to PnW nation | 404 — page shows error message from API |
| Zero valid targets | 200 with empty picks — page shows summary only |
| PnW API unreachable | 502 — page shows error with retry |
| Ollama unreachable | 502 "AI service unavailable — is Ollama running?" |
| Ollama returns malformed/unexpected JSON | 502 "AI returned an unexpected response — try again" |

## Out of Scope

- Streaming responses
- Manual nation ID input
- Caching AI results between requests
- Configurable model name or Ollama URL
