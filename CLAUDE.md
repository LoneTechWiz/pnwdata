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

**Key insight**: All pages are purely client-side (`"use client"`) and fetch from the local `/api/data` route, never directly from PnW's API. The server-side sync loop is the only thing that touches external APIs.

### Core Files

| File | Role |
|------|------|
| `src/lib/db.ts` | SQLite singleton; creates all tables on first import |
| `src/lib/sync.ts` | Fetches PnW + BK Net APIs, writes to SQLite; `startSyncLoop()` runs every 10 min |
| `src/lib/pnw.ts` | TypeScript types + `fetchMembers/fetchWars/...` client fetchers (call `/api/data`) |
| `src/instrumentation.ts` | Calls `startSyncLoop()` on server boot (Node.js runtime only) |
| `src/app/api/data/route.ts` | `GET ?type=<table>` — reads SQLite, returns JSON |
| `src/app/api/sync/route.ts` | `POST` triggers manual sync; `GET` returns status |

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

### Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard |
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
PNW_API_KEY=        # Politics and War API key
BKNET_API_TOKEN=    # BK Net API token (optional; BK Net features disabled if absent)
```

### Key Config

- `next.config.ts` must keep `serverExternalPackages: ['better-sqlite3']`
- SQLite DB at `data/pnw.db` — excluded from git

### Deployment Notes

- The app runs in **production mode** (`next start`), not dev mode
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
