# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000) with Turbopack
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
npm test         # Run Vitest suite
npm run sync:worker # Run the local scheduled sync worker
docker compose up -d --build # Build and run the complete local runtime
```

## Architecture

This is a **Politics and War (PnW) alliance analytics dashboard** — a self-hosted Next.js 16 App Router app. The production Docker container runs both Next.js and the scheduled sync worker, with durable state in a bind-mounted SQLite database. Discord gateway operations live in the sibling `darth-protocol` service.

### Data Flow

```
PnW GraphQL API
        ↓  (every 10 min via sync.ts)
  data/pnw.db (SQLite WAL)
        ↓  (via /api/data?type=...)
  React pages (useQuery → fetchMembers etc.)

pnwdata ← authenticated local HTTP → darth-protocol ← Discord gateway
```

**Key insight**: Most pages are purely client-side (`"use client"`) and fetch from `/api/data`. **Exception**: `/api/warTargets`, `/api/conflictStats`, and `/api/beigeWatch` call the PnW GraphQL API directly on each request — these are live-data routes. The server-side sync loop handles all other external API access.

### Core Files

| File | Role |
|------|------|
| `src/lib/db.ts` | Server-only SQLite connection, schema bootstrap, and shared data lookups |
| `src/lib/sync.ts` | Fetches the PnW API and writes to SQLite; `startSyncLoop()` runs the main sync every 10 min and recruitment sync daily |
| `src/lib/sync-request.ts` | Durable manual-sync handoff in SQLite; the worker claims and runs queued requests |
| `scripts/sync-worker.ts` | Scheduled sync entrypoint supervised alongside Next.js by the container entrypoint |
| `src/lib/pnw.ts` | TypeScript types + `fetchMembers/fetchWars/...` client fetchers (call `/api/data`) |
| `src/app/api/data/route.ts` | `GET ?type=<table>` — reads SQLite, returns JSON |
| `src/app/api/sync/route.ts` | `POST` queues a manual sync for the local worker; `GET` returns status |
| `src/app/api/warTargets/route.ts` | Calls PnW GraphQL directly; uses SQLite for cached prices and membership lookup |
| `src/app/api/conflictStats/route.ts` | Calls PnW GraphQL directly |
| `src/app/api/beigeWatch/route.ts` | Calls PnW GraphQL directly; uses SQLite for cached prices |
| `src/app/api/war-config/route.ts` | GET/POST SQLite-backed war configuration; requires `canManage` (Emperor or `/war-config` role) |
| `src/lib/session.ts` | JWT session helpers (HS256 via `jose`); reads `SESSION_SECRET` |
| `src/lib/role-config.ts` | Reads/writes SQLite-backed role configuration; `hasAccess()` checks Discord role IDs |
| `src/lib/offshore-config.ts` | CRUD for member-submitted offshore/extension API keys; verifies each key against the PnW API and masks it before it ever reaches the client |
| `src/lib/offshore-sync.ts` | Syncs members/wars/bank records per configured offshore alliance into the `offshore_*` tables; `startOffshoreSyncLoop()` runs every 10 min |
| `src/app/api/offshore-config/route.ts` | GET (any logged-in member) / POST (add+verify a key) / DELETE (submitter or `/offshore-config` role only) |
| `src/lib/tax-revenue.ts` | Syncs P&W tax brackets + automatic tax collection records (`taxrecs`, distinct from `bankrecs`) per alliance; computes real revenue as `actual × (real_rate / nominal_rate)` using each bracket's admin-configured real rate. Each record's resources are priced in USD against `trade_prices` once, at sync time, and that value is stored on the record (`resource_value_usd`) rather than recomputed at read time |
| `src/app/api/tax-config/route.ts` | GET/POST SQLite-backed real tax rates per bracket; requires `canManage` (Emperor or `/tax-config` role) |
| `src/app/api/tax-revenue/route.ts` | GET the computed actual/real/safekept revenue (money + resource value) per bracket, plus last-24h and 30-day-daily-average totals, across all alliances; requires `/revenue` role or Emperor |
| `src/app/api/tax-revenue/records/route.ts` | GET individual tax payments (one row per nation per payment) from the last 24h, for the per-nation CSV export; same access check as `/api/tax-revenue` |

### Database Tables

Snapshot rows store JSON text in a `data TEXT` column alongside an `updated_at INTEGER` (Unix ms timestamp):

- `nations` — alliance members (**excludes** APPLICANTs; filtered in sync.ts by `alliance_position !== "APPLICANT"`)
- `applicants` — nations with `alliance_position === "APPLICANT"`; upserted each sync, fully deleted if none
- `wars` — active wars (fully replaced each sync)
- `bankrecs` — last 500 bank records (upserted)
- `alliance_meta` — single row (id=1) with alliance stats
- `trade_prices` — single row (id=1) with 24h average market prices
- `discord_nation_links` — nation-to-Discord mappings derived from server nicknames by `darth-protocol`
- `game_info` — single row (id=1) with radiation levels per continent
- `sync_status` — single row (id=1) tracking last sync time, status, counts
- `offshore_alliances` — one row per member-submitted offshore/extension API key (masked before leaving the server), who added it, and its sync status/counts
- `offshore_nations`, `offshore_wars`, `offshore_bankrecs` — same shape as `nations`/`wars`/`bankrecs` but keyed by `(alliance_id, id)`, one set per configured offshore alliance; `ON DELETE CASCADE` from `offshore_alliances`
- `offshore_alliance_meta` — like `alliance_meta`, keyed by `alliance_id`
- `tax_bracket_config` — one row per `(alliance_id, bracket_id)`: bracket name + nominal rate synced from P&W, plus the admin-configured real rate (defaults to the nominal rate until edited via `/tax-config`, and is preserved across re-syncs)
- `tax_records`, `offshore_tax_records` — automatic tax collection events from P&W's `taxrecs` field (not `bankrecs` — those don't carry a usable `tax_id`), same JSON-blob shape as `bankrecs`

### Frontend Patterns

- All pages use `useQuery` from TanStack Query with `refetchInterval: 10 * 60 * 1000`
- Data comes from the typed fetchers in `pnw.ts` (`fetchMembers`, `fetchWars`, etc.)
- `AppShell` wraps every page (sidebar nav + header with sync status)
- Charts use Recharts; icons use lucide-react
- Tailwind dark theme: background `#0f1117`, cards `#161b2e`, borders `#2a3150`
- **CSV export**: `src/lib/excel.ts` exports safe, Excel-compatible CSV files. `src/components/ExportButton.tsx` wraps it as a reusable button.
- **Rules of Hooks**: All `useMemo`/`useCallback` calls must come **before** any conditional early returns (loading/error guards). Violation causes runtime crash on direct URL navigation when TanStack Query cache is cold.
- **Discord identity**: `darth-protocol` parses the final bracketed nation ID from each server nickname and snapshots `nation_id`, Discord ID, and username into `discord_nation_links`.
- **Nation data**: Resources, spies, and project ownership come directly from the PnW GraphQL API.

### Auth & Access Control

Discord OAuth flow: `/api/auth/discord` asks the private `darth-protocol` API for the authorization URL → Discord → `/api/auth/callback` sends the code to `darth-protocol` → sets `__session` JWT cookie (7-day, HS256). Session stores `discordId`, `username`, `avatar`, `roleIds[]`, `isEmperor`. Discord client credentials and guild configuration are not pnwdata environment variables.

- `isEmperor`: the user has the role named or identified by `DISCORD_ADMIN_ROLE` (default `"Emperor"`)
- Per-page role access is stored in the local SQLite `app_config` table; managed via `/role-config` UI
- `hasAccess(config, pathname, roleIds)` in `src/lib/role-config.ts` is the access check

### Sidebar Nav Structure

The sidebar has three tiers:
- **Public nav** (`nav` array in `Sidebar.tsx`): War Targets, Conflict Stats — visible to all
- **Member nav** (`hiddenNav` array): all other pages — visible only when Discord-authenticated (`isLoggedIn`)
- **Admin nav**: Role Config, War Config — visible only when `me.canManageRoles` (Emperor or has the respective Discord role)

**Adding a new member page requires changes in three places:**
1. `src/components/Sidebar.tsx` — add entry to `hiddenNav`
2. `/role-config` — add the route with its allowed Discord role ID array
3. `src/app/role-config/page.tsx` — add route to the `ALL_PAGES` constant

### Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with links to War Targets and, for authenticated users, Raid Finder |
| `/dashboard` | Alliance overview — member counts, military totals, active wars, top members by score |
| `/war-targets` | War target finder — fetches live from PnW API using SQLite-backed enemy IDs |
| `/conflict` | Conflict stats — damage inflicted/received per alliance/nation for the current war |
| `/slots` | Need to Declare — members with fewer than N offensive wars, active in last 72h, not in VM |
| `/members` | Alliance member list with military stats |
| `/applicants` | Pending applicants sorted by last active |
| `/military` | Military overview |
| `/mmr` | MMR Checker — input buildings per city, see who's at max units + spies |
| `/wars` | Active wars |
| `/cashholders` | Stockpile — nations exceeding per-city thresholds for cash, gasoline, munitions, steel, or aluminum (VM nations excluded) |
| `/charts` | Charts |
| `/inactive` | Inactive members |
| `/relink` | Members whose nation ID is missing from Discord server nicknames |
| `/explore` | Explore nations |
| `/stagnant-cities` | Nations with more than N (default 120) turns since their newest city (from per-city `date`), sorted by city count, with CSV/Excel export |
| `/command-center` | Per-nation war viewer — select a member to see their active wars with resistance/points/unit counts |
| `/beige-watch` | Enemy nations currently on beige — sortable by turns remaining, optional score-range filter |
| `/raid-finder` | Local raid target ranking using inactivity, beige loot, GNI snapshots, and visible bank records |
| `/raid-config` | Admin UI for the minimum raid inactivity threshold |
| `/role-config` | Admin UI to assign Discord roles to page access (canManageRoles only) |
| `/war-config` | Admin UI to manage enemy/ally alliance IDs in SQLite (canManageRoles only) |
| `/offshore-config` | Lets any logged-in member submit a P&W API key for an offshore or extension alliance; the app verifies it, detects the alliance automatically, and syncs the same member/war/bank data it tracks for the main alliance. Visible to Emperors and to any role granted access via `/role-config` |
| `/revenue` | Actual tax collected vs. real alliance revenue vs. member safekept amount, per bracket and per alliance (main + offshore) |
| `/tax-config` | Admin UI to set the real rate per P&W tax bracket (capped at the bracket's nominal rate); e.g. a bracket nominally at 100/100 with a real rate of 20/20 means 80% of what's collected is member safekeep, not alliance revenue |

### External APIs

- **PnW GraphQL**: `https://api.politicsandwar.com/graphql?api_key=PNW_API_KEY`
  - Pagination uses `first:` argument (not `limit:`)
  - `alliance_id` from GraphQL returns as **string** — wrap with `Number()` before using as `[Int]`
  - `Alliance.tax_brackets` and `Alliance.taxrecs` (the latter uses `limit:`, not `first:`) require a dedicated alliance-position permission beyond general bank view access — both return `null` silently if the API key's nation lacks it. `tax_id` on plain `bankrecs` is not a reliable substitute; it's consistently `"0"` even when `taxrecs` has real data.

### Environment Variables

```
PNW_API_KEY=           # Politics and War API key
PUBLIC_APP_URL=        # Browser-facing origin used for authentication redirects
SESSION_SECRET=        # JWT signing secret, min 32 chars
BOT_SERVICE_TOKEN=     # Shared bearer token for pnwdata <-> darth-protocol
DARTH_PROTOCOL_URL=    # Private darth-protocol HTTP endpoint
PNW_DB_PATH=           # SQLite path (defaults to data/pnw.db)
```

### Key Config

- SQLite `app_config` row `role-config` maps page paths to allowed Discord role ID arrays; manage it via `/role-config`
- SQLite `app_config` row `war-config` stores runtime war configuration; manage it via `/war-config`:
  - `enemy_alliance_ids: number[]` — enemy alliance IDs; fetched live by `/api/warTargets` and `/api/conflictStats`
  - `ally_alliance_ids: number[]` — ally alliance IDs; used by `/api/conflictStats` to label each coalition side
- SQLite `app_config` row `raid-finder-config` stores the minimum inactive days; manage it via `/raid-config`
- Offshore/extension API keys live in the dedicated `offshore_alliances` table (not `app_config`), since each key belongs to a specific submitter and alliance rather than being a single shared setting; manage it via `/offshore-config`

### Discord Bot Boundary

The Discord client is owned by `../darth-protocol`; this repository must not contain or launch a gateway bot. Website routes use `src/lib/darth-protocol.ts` for guild member/role lookups and nation-ID-addressed DMs. Darth Protocol parses nation IDs from member nicknames and calls bearer-protected `/api/bot/*` routes to refresh those links and claim stockpile alerts. Both processes must use the same `BOT_SERVICE_TOKEN`.

### Deployment Notes

- Production is deployed with `docker compose up -d --build`.
- `docker-entrypoint.sh` supervises `next start` and the sync worker; if either exits, the container exits and Docker restarts the unit.
- `./data` is bind-mounted at `/app/data`; never bake the SQLite database into the image.
- Verify a deployment with `docker compose ps`, `docker compose logs`, and `curl --fail http://127.0.0.1:3000/api/health`.
- Put a TLS reverse proxy in front of the Next.js port for public deployments.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
