# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000) with Turbopack
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

No test suite exists in this project.

## Architecture

This is a **Politics and War (PnW) alliance analytics dashboard** — a Next.js 16 App Router app that syncs data from external APIs into a local SQLite database and serves it to a React frontend.

### Data Flow

```
PnW GraphQL API + BK Net REST API
        ↓  (every 10 min via sync.ts)
  SQLite (data/pnw.db)
        ↓  (via /api/data?type=...)
  React pages (useQuery → fetchMembers etc.)
```

**Key insight**: Most pages are purely client-side (`"use client"`) and fetch from the local `/api/data` route. **Exception**: `/api/warTargets`, `/api/conflictStats`, and `/api/beigeWatch` call the PnW GraphQL API directly on each request (no SQLite cache) — these are live-data routes. The server-side sync loop handles all other external API access.

### Core Files

| File | Role |
|------|------|
| `src/lib/db.ts` | SQLite singleton; creates all tables on first import |
| `src/lib/sync.ts` | Fetches PnW + BK Net APIs, writes to SQLite; `startSyncLoop()` runs every 10 min |
| `src/lib/pnw.ts` | TypeScript types + `fetchMembers/fetchWars/...` client fetchers (call `/api/data`) |
| `src/instrumentation.ts` | Calls `startSyncLoop()` on server boot (Node.js runtime only) |
| `src/app/api/data/route.ts` | `GET ?type=<table>` — reads SQLite, returns JSON |
| `src/app/api/sync/route.ts` | `POST` triggers manual sync; `GET` returns status |
| `src/app/api/warTargets/route.ts` | Calls PnW GraphQL directly; no SQLite cache |
| `src/app/api/conflictStats/route.ts` | Calls PnW GraphQL directly; no SQLite cache |
| `src/app/api/beigeWatch/route.ts` | Calls PnW GraphQL directly; no SQLite cache |
| `src/lib/session.ts` | JWT session helpers (HS256 via `jose`); reads `SESSION_SECRET` |
| `src/lib/role-config.ts` | Reads/writes `data/role-config.json`; `hasAccess()` checks Discord role IDs |

### Database Tables

All rows store JSON blobs in a `data TEXT` column alongside an `updated_at INTEGER` (Unix ms timestamp):

- `nations` — alliance members (**excludes** APPLICANTs; filtered in sync.ts by `alliance_position !== "APPLICANT"`)
- `applicants` — nations with `alliance_position === "APPLICANT"`; upserted each sync, fully deleted if none
- `wars` — active wars (fully replaced each sync)
- `bankrecs` — last 500 bank records (upserted)
- `alliance_meta` — single row (id=1) with alliance stats
- `trade_prices` — single row (id=1) with 24h average market prices
- `bknet_members` — member data from BK Net (includes resources, spies, projects, Discord)
- `game_info` — single row (id=1) with radiation levels per continent
- `sync_status` — single row (id=1) tracking last sync time, status, counts

### Frontend Patterns

- All pages use `useQuery` from TanStack Query with `refetchInterval: 10 * 60 * 1000`
- Data comes from the typed fetchers in `pnw.ts` (`fetchMembers`, `fetchWars`, etc.)
- `AppShell` wraps every page (sidebar nav + header with sync status)
- Charts use Recharts; icons use lucide-react
- Tailwind dark theme: background `#0f1117`, cards `#161b2e`, borders `#2a3150`
- **Excel export**: `src/lib/excel.ts` exports `exportToExcel(filename, data[])` using SheetJS (`xlsx`). `src/components/ExportButton.tsx` wraps it as a reusable button — used on every list page.
- **Rules of Hooks**: All `useMemo`/`useCallback` calls must come **before** any conditional early returns (loading/error guards). Violation causes runtime crash on direct URL navigation when TanStack Query cache is cold.
- **BK Net ID map keys**: Always use `String(m.nation.id)` when building maps and `String(m.id)` when looking up — BK Net IDs arrive as strings at runtime despite TypeScript typing them as `number`.
- **Nation resource fields**: `money`, `gasoline`, `munitions`, `steel`, `aluminum` are fetched from the PnW GraphQL API and stored in the `nations` table — these reflect stockpile on the nation, not the alliance bank. Do not use BK Net `resources` for these, as BK Net includes alliance account funds.

### Auth & Access Control

Discord OAuth flow: `/api/auth/login` → Discord → `/api/auth/callback` → sets `__session` JWT cookie (7-day, HS256). Session stores `discordId`, `username`, `avatar`, `roleIds[]`, `isEmperor`.

- `isEmperor`: Discord username matches `DISCORD_ADMIN_ROLE` env var (default `"Emperor"`)
- Per-page role access: `data/role-config.json` maps route paths to allowed Discord role ID arrays; managed via `/role-config` UI
- `hasAccess(config, pathname, roleIds)` in `src/lib/role-config.ts` is the access check

### Sidebar Nav Structure

The sidebar has three tiers:
- **Public nav** (`nav` array in `Sidebar.tsx`): War Targets, Conflict Stats, City Build — visible to all
- **Member nav** (`hiddenNav` array): all other pages — visible only when Discord-authenticated (`isLoggedIn`)
- **Admin nav**: Role Config — visible only when `me.canManageRoles` (Emperor or has the role-config Discord role)

**Adding a new member page requires changes in three places:**
1. `src/components/Sidebar.tsx` — add entry to `hiddenNav`
2. `data/role-config.json` — add route with allowed role ID array (use `git add -f data/role-config.json` since `data/` is in `.gitignore`)
3. `src/app/role-config/page.tsx` — add route to the `ALL_PAGES` constant

### Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with links to War Targets and City Build |
| `/dashboard` | Alliance overview — member counts, military totals, active wars, top members by score |
| `/war-targets` | War target finder — fetches live from PnW API using `data/war-config.json` enemy IDs |
| `/conflict` | Conflict stats — damage inflicted/received per alliance/nation for the current war |
| `/slots` | Need to Declare — members with fewer than N offensive wars, active in last 72h, not in VM |
| `/members` | Alliance member list with military stats |
| `/applicants` | Pending applicants sorted by last active |
| `/military` | Military overview |
| `/mmr` | MMR Checker — input buildings per city, see who's at max units + spies |
| `/infra` | Infrastructure & land stats |
| `/wars` | Active wars |
| `/bank` | Bank records |
| `/cashholders` | Stockpile — nations exceeding per-city thresholds for cash, gasoline, munitions, steel, or aluminum (VM nations excluded) |
| `/charts` | Charts |
| `/inactive` | Inactive members |
| `/optimizer` | City Build Optimizer |
| `/explore` | Explore nations |
| `/command-center` | Per-nation war viewer — select a member to see their active wars with resistance/points/unit counts |
| `/beige-watch` | Enemy nations currently on beige — sortable by turns remaining, optional score-range filter |
| `/role-config` | Admin UI to assign Discord roles to page access (canManageRoles only) |

### External APIs

- **PnW GraphQL**: `https://api.politicsandwar.com/graphql?api_key=PNW_API_KEY`
  - Pagination uses `first:` argument (not `limit:`)
  - `alliance_id` from GraphQL returns as **string** — wrap with `Number()` before using as `[Int]`
- **BK Net REST**: `https://bkpw.net/api/v1` with `Authorization: Bearer BKNET_API_TOKEN`
  - Nation IDs are numbers; use `String(m.nation.id)` as map keys
  - Projects at `m.nation.projects` (`Record<string, boolean>`)
  - Discord at `m.discord?.account?.discord_username`

### Environment Variables

```
PNW_API_KEY=           # Politics and War API key
BKNET_API_TOKEN=       # BK Net API token (optional; BK Net features disabled if absent)
SESSION_SECRET=        # JWT signing secret, min 32 chars
DISCORD_CLIENT_ID=     # Discord OAuth app client ID
DISCORD_CLIENT_SECRET= # Discord OAuth app client secret
DISCORD_REDIRECT_URI=  # Full callback URL, e.g. https://example.com/api/auth/callback
DISCORD_GUILD_ID=      # Discord server ID for member/role lookup
DISCORD_ADMIN_ROLE=    # Username that grants isEmperor (default: "Emperor")
NEXT_PUBLIC_TURNSTILE_SITE_KEY= # Cloudflare Turnstile site key (required at build time)
TURNSTILE_SECRET_KEY=           # Cloudflare Turnstile secret key (required at runtime)
```

### Key Config

- `next.config.ts` must keep `serverExternalPackages: ['better-sqlite3']`
- SQLite DB at `data/pnw.db` — excluded from git
- `data/role-config.json` — maps page paths to allowed Discord role ID arrays; managed via `/role-config` UI; **not** excluded from git
- `data/war-config.json` — runtime config for war features; **not** excluded from git. Edit this file to update enemy/ally alliance lists:
  - `enemy_alliance_ids: number[]` — enemy alliance IDs; fetched live by `/api/warTargets` and `/api/conflictStats`
  - `ally_alliance_ids: number[]` — ally alliance IDs; used by `/api/conflictStats` to label each coalition side

### Deployment Notes

- The app runs in **production mode** (`next start`), not dev mode
- **Before building**: ensure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set — it is inlined at build time and cannot be changed without a rebuild.
- After any code change: `npm run build` then restart the server:
  ```bash
  kill -9 $(ss -tlnp | grep ':3000' | grep -oP 'pid=\K[0-9]+')
  nohup npm run start > /tmp/nextjs.log 2>&1 &
  sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
  ```
- `pkill -f "next start"` is unreliable (exits 144, process survives) — always use the `ss`/`kill -9` approach above
- **Stale chunk pitfall**: static pages are prerendered with JS chunk hashes baked into the HTML. If the old server process keeps running after a rebuild, it serves HTML referencing chunks that no longer exist, causing 500s on chunk fetches and a frozen "Loading…" UI. Always confirm the old process is dead before starting the new one.

### BK Net Resilience

- BK Net is fetched **separately** from the PnW `Promise.all` in `sync.ts`, with `.catch()` so a BK Net outage never fails the whole sync
- If BK Net is down: logs `[PnW Sync] BK Net unavailable, skipping: <reason>` and continues with stale BK Net data; retries next cycle

### PnW Game Formulas (used in optimizer page)

- **Slots**: `floor(infra / 50)`
- **Nuclear power**: 1 plant per `ceil(infra / 2000)` slots; $10,500/day + 1.8 uranium/day/plant
- **Disease rate**: `max(0, (infra/100)² × 0.1 + infra/100 − 25) / 100` (as a percentage)
  - Each hospital reduces disease by 2.5 percentage points (max 5 hospitals/city)
  - Hospitals needed for 0 disease: `ceil(baseDisease / 2.5)`
- **Commerce income**: `((commerce% / 50) × 0.725 + 0.725) × effectivePopulation × 12`
  - `effectivePopulation = infra × 100 × (1 − disease% / 100)`
  - Disease directly reduces population and therefore commerce income
- **Max commerce**: 100% base, 115% with ITC project, 125% with ITC + Telecom Sat
- **Commerce buildings** (per city): Stadium +12% (max 3), Shopping Mall +9% (max **5**), Subway +8% (max 1), Bank +5% (max **6**), Supermarket +3% (max 6)
- **Farm food/day**: `(land / 400) × 12` with Mass Irrigation, `(land / 500) × 12` without — then multiply by specialization bonus `1 + (0.5 × (farms−1) / 19)` for n farms
- **Steel Mill**: 9 steel/day from 3 iron + 3 coal, $4,000/day op cost, max 5/city
- **Aluminum Refinery**: 9 aluminum/day from 3 bauxite, $2,500/day, max 5/city
- **Munitions Factory**: 18 munitions/day from 6 lead, $4,000/day, max 5/city
- **Oil Refinery**: 6 gasoline/day from 3 oil, $4,000/day, max 5/city
- **Military buildings** (consume slots, no income): Barracks $3,000/day (max 5), War Factories $3,000/day (max 5), Hangars $1,000/day (max 5), Dockyards $2,500/day (max 3)
- **Civil buildings** (consume slots, reduce disease/crime/pollution): Hospitals $1,000/day (max 5), Police Stations $750/day (max 5), Recycling Centers $2,500/day (max 3)
- **MMR unit caps**: Soldiers = barracks×3000×cities, Tanks = factories×250×cities, Aircraft = hangars×15×cities, Ships = dockyards×5×cities
- **Spy caps**: 60 with Intelligence Agency project, 50 without; training rate 2/day
