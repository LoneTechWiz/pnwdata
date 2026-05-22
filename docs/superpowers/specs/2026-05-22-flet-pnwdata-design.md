# flet-pnwdata — Design Spec

## Overview

A 1:1 port of the existing Next.js PnW alliance analytics dashboard to a Flet-based stack, sitting in a sibling `flet-pnwdata/` directory and targeting **web, desktop, and mobile** from a single Python codebase.

The port uses a **two-component architecture (Approach B)**:

- A **FastAPI server** that owns the SQLite database, runs the 10-minute background sync against PnW + BK Net, hosts JSON endpoints, and handles Discord OAuth token exchange.
- A **Flet client** that runs unchanged on web, desktop, and mobile, calls the FastAPI server over HTTP, and renders the UI.

Native clients are thin: they ship no API keys and depend on a reachable FastAPI host. This is the explicit trade-off made so the desktop/mobile apps can be distributed without leaking `PNW_API_KEY`, `BKNET_API_TOKEN`, or `DISCORD_BOT_TOKEN`.

The existing Next.js app is unaffected. `bot.js` is unchanged and continues to run as a separate Node process against the new SQLite DB (or the original — see "Coexistence" below).

---

## Goals

1. Feature-complete equivalent of every Next.js page (22 routes)
2. Identical Discord OAuth + role-gating behavior, working on web/desktop/mobile
3. Independent SQLite DB and sync loop owned by the FastAPI server (no dependency on the Next.js app at runtime)
4. Visual parity with the current dark theme (`#0f1117` / `#161b2e` / `#2a3150`)
5. Single Python codebase for client across all three platforms

## Non-goals

- Porting `bot.js` to Python (stays in Node; can be done later)
- Replacing the Next.js app (the two coexist; choice of which to point at is operational)
- Offline-capable native clients (server is required)
- Refresh-token rotation or server-side JWT invalidation (matches current Next.js — 7-day expiry, logout is client-only)

---

## Project Structure

```
flet-pnwdata/
├── pyproject.toml            # uv/pip project, Python 3.12+
├── .env.example
├── README.md
├── start.sh
├── data/                     # server-only persistent state
│   ├── pnw.db                # gitignored
│   ├── role-config.json
│   └── war-config.json
│
├── server/                   # FastAPI backend
│   ├── main.py               # FastAPI app, lifespan starts sync loop
│   ├── db.py                 # sqlite3 singleton + schema init
│   ├── sync.py               # 10-min background sync task
│   ├── pnw_api.py            # PnW GraphQL client (httpx)
│   ├── bknet_api.py          # BK Net REST client (httpx)
│   ├── session.py            # JWT issue/verify (PyJWT, HS256)
│   ├── auth.py               # /api/auth/exchange + guild member resolution
│   ├── role_config.py        # data/role-config.json + has_access()
│   ├── war_config.py         # data/war-config.json
│   └── routes/
│       ├── data.py           # GET /api/data?type=<table>
│       ├── sync.py           # GET/POST /api/sync
│       ├── war_targets.py
│       ├── conflict_stats.py
│       ├── beige_watch.py
│       ├── export.py         # GET /api/export?type=<table> → .xlsx
│       └── config.py         # GET/POST /api/war-config + /api/role-config
│
├── client/                   # Flet app
│   ├── main.py               # ft.app entry, route table, session bootstrap
│   ├── settings.py           # API_BASE_URL loader
│   ├── api.py                # httpx client + 10-min cache wrapping every server endpoint
│   ├── auth.py               # Discord OAuth via Flet OAuthProvider + token exchange
│   ├── theme.py              # dark theme matching current colors
│   ├── shell/
│   │   ├── app_shell.py
│   │   ├── sidebar.py
│   │   └── header.py
│   ├── pages/                # one module per route, exports build(page, ctx) -> ft.View
│   │   ├── home.py, dashboard.py, war_targets.py, conflict.py, slots.py,
│   │   ├── members.py, applicants.py, military.py, mmr.py, infra.py,
│   │   ├── wars.py, bank.py, cashholders.py, charts.py, inactive.py,
│   │   ├── relink.py, optimizer.py, explore.py, command_center.py,
│   │   ├── beige_watch.py, role_config.py, war_config.py
│   └── components/
│       ├── data_table.py
│       ├── stat_card.py
│       ├── export_button.py
│       └── chart.py
│
└── shared/                   # imported by both server and client
    ├── models.py             # pydantic types: Nation, War, BankRec, AllianceMeta, ...
    └── formulas.py           # PnW game formulas (slots, disease, commerce, MMR caps, …)
```

`shared/` is the contract. Server returns JSON validated against `shared/models.py`; client deserializes the same models. No type drift.

---

## Data Flow

```
PnW GraphQL  +  BK Net REST
        │
        │  every 10 min, server/sync.py asyncio task
        ▼
  SQLite (data/pnw.db)  ←─── single writer: the sync task
        │
        │  GET /api/data?type=<table>  (httpx from client)
        ▼
  Flet client renders
```

The current Next.js DB schema is preserved exactly:
- `nations`, `applicants`, `wars`, `bankrecs`, `alliance_meta`, `trade_prices`, `bknet_members`, `game_info`, `sync_status`
- Same column layout: `data TEXT` blob + `updated_at INTEGER`
- Same APPLICANT filtering rule in `nations`

### Sync loop (`server/sync.py`)

- Started in FastAPI lifespan: `asyncio.create_task(sync_loop())`
- Loop: `await sync_once()`; `await asyncio.sleep(600)`; repeat
- `sync_once()` runs PnW fetches via `asyncio.gather`; BK Net runs separately in a `try/except` so a BK Net outage doesn't fail the whole sync (preserves current Next.js resilience behavior)
- Writes one transaction per table
- Updates `sync_status` row at the end
- Manual trigger: `POST /api/sync` calls `sync_once()` and returns when complete

### Cached vs live endpoints

| Endpoint | Source | Notes |
|---|---|---|
| `GET /api/data?type=<table>` | SQLite | Read-only. Public for tables used by public pages; otherwise gated. |
| `GET /api/sync` | SQLite (`sync_status` row) | UI poll for sync state. Public. |
| `POST /api/sync` | Triggers `sync_once()` | Admin only. |
| `GET /api/warTargets?nation_id=…` | **Live PnW GraphQL** | No cache. Uses `data/war-config.json` enemies. |
| `GET /api/conflictStats` | **Live PnW GraphQL** | No cache. |
| `GET /api/beigeWatch` | **Live PnW GraphQL** | Capped at 30 days / 5 pages (matches commit `cf39dd9`). |
| `GET /api/export?type=<table>` | SQLite → openpyxl | Returns `.xlsx` as download. |
| `GET/POST /api/war-config` | `data/war-config.json` | Admin only. |
| `GET/POST /api/role-config` | `data/role-config.json` | Admin only. |

### Client refresh strategy

`client/api.py` implements a small TanStack-Query analogue:

- Each typed fetcher (`fetch_members()`, `fetch_wars()`, …) has an in-memory cache keyed by `(endpoint, params)` with a 10-minute TTL.
- Pages call fetchers on mount AND start a `page.run_task(refresh_loop)` that re-fetches every 10 min while the page is visible (cancelled on `on_disconnect` or route change).
- A "Refresh" button on each page bypasses the cache.

---

## Auth and Access Control

The client uses Flet's built-in `OAuthProvider` to drive the platform-appropriate OAuth UX (popup on web, system browser + localhost listener on desktop, in-app webview on mobile). It then exchanges the Discord token with the server for a server-issued JWT.

### Flow

```
1. User clicks "Log in with Discord" in the Flet UI
2. page.login(DiscordOAuthProvider) → Flet opens authorization URL
   • Web: popup window
   • Desktop: system browser + temporary localhost listener
   • Mobile: in-app webview
3. User authorizes. Flet receives Discord access_token + identity.
4. Flet calls POST /api/auth/exchange { discord_access_token }
5. Server:
   a. Verifies the token by calling GET https://discord.com/api/v10/users/@me
   b. Resolves guild member via bot token:
        GET https://discord.com/api/v10/guilds/{GUILD_ID}/members/{USER_ID}
        Authorization: Bot {DISCORD_BOT_TOKEN}
      (this matches commit 412cf35 — uses bot token, not OAuth scope)
   c. Builds session payload:
        { discordId, username, avatar, roleIds[], isEmperor }
      where isEmperor = (username == DISCORD_ADMIN_ROLE env var, default "Emperor")
   d. Signs JWT with PyJWT (HS256, 7-day expiry) using SESSION_SECRET
   e. Returns { token, session }
6. Flet stores token in page.client_storage.set("session_token", token)
7. All subsequent API calls include Authorization: Bearer <token>
8. Server has a FastAPI dependency that decodes the JWT, attaches session
   to request.state, and enforces role-config access on protected routes
```

### Token storage by platform

- Web: `client_storage` → `localStorage`
- Desktop: Flet app-data directory on disk
- Mobile: platform keychain (iOS Keychain / Android Keystore via Flet)

### Role gating

- `data/role-config.json` is the source of truth — same format as the Next.js app: map of route path → array of allowed Discord role IDs
- Server enforces on each protected endpoint via a `requires_access(path)` dependency
- Client mirrors the check to control sidebar visibility (three tiers: public / member / admin)
- `isEmperor` = Discord username matches `DISCORD_ADMIN_ROLE` (default `"Emperor"`)
- `canManageRoles` = isEmperor OR has the role mapped to `/role-config`
- `canManageWarConfig` = isEmperor OR has the role mapped to `/war-config`

### Public endpoints

These require no JWT (matches current Next.js public-page set):
- `GET /api/warTargets`
- `GET /api/conflictStats`
- `GET /api/beigeWatch`
- `GET /api/sync` (read-only status)
- `GET /api/data?type=` for `alliance_meta`, `trade_prices`, `game_info`

---

## Pages

Routing uses `page.go("/path")` and an `on_route_change` handler that maps URLs to `View` builders. All views are wrapped by `AppShell`. Each `pages/<name>.py` exports `build(page, ctx) -> ft.View`, where `ctx` carries the API client and current session.

```
Public:   /, /war-targets, /conflict, /optimizer
Member:   /dashboard, /slots, /members, /applicants, /military, /mmr,
          /infra, /wars, /bank, /cashholders, /charts, /inactive,
          /relink, /explore, /command-center, /beige-watch
Admin:    /role-config, /war-config
```

The page list matches the current Next.js app exactly. Each page renders a denied placeholder when `has_access()` returns false for the current session.

---

## Components and Theming

### Shared components

- `AppShell(page, route, body)` — sidebar + header wrapper
- `Sidebar(session)` — three-tier nav (`ft.NavigationRail` on wide layouts; `ft.NavigationDrawer` on narrow)
- `Header(session, sync_status)` — last sync time, "Sync now" (admin), login/avatar chip
- `StatCard(label, value, sublabel, icon)`
- `DataTable(rows, columns, *, sortable=True, exportable=True)` — wraps `ft.DataTable`, adds sort, filter input, and an export button
- `Chart(type, data, x_key, y_keys)` — wraps `ft.LineChart` / `ft.BarChart` / `ft.PieChart`
- `LoadingSkeleton`, `EmptyState`, `ErrorBanner`
- `ExportButton(table)` — calls `page.launch_url(f"{api_base}/api/export?type={table}&token=…")` and lets the OS handle the download

### Theme

```python
DARK_THEME = ft.Theme(
    color_scheme=ft.ColorScheme(
        background="#0f1117",
        surface="#161b2e",
        outline="#2a3150",
        primary="#6366f1",
        on_background="#e5e7eb",
    ),
    font_family="Inter",
    visual_density=ft.VisualDensity.COMPACT,
)
```

### Responsive behavior

- Wide (≥ 700px): `NavigationRail` sidebar, multi-column layouts
- Narrow (< 700px): hamburger `NavigationDrawer`, columns stack, data-heavy tables collapse to per-row cards

### Excel export

- Server: `/api/export?type=<table>` reads SQLite, builds workbook with `openpyxl`, streams the bytes back with `Content-Disposition: attachment`
- Client (all platforms): `page.launch_url(...)` → OS handles the download. One implementation; three platforms.

### `/optimizer` (City Build Optimizer)

The most interactive page. Inputs (`ft.Slider`, `ft.Dropdown`) drive a recompute against `shared/formulas.py`, which holds the exact PnW formulas currently in the Next.js page (slots, nuclear power, disease, commerce, farms, mills, MMR caps, etc.). Same math, run in Python, displayed via Flet widgets.

---

## External APIs (server-side only)

- **PnW GraphQL** — `https://api.politicsandwar.com/graphql?api_key={PNW_API_KEY}`. Pagination via `first:`. Note: `alliance_id` is returned as a string from GraphQL — wrap with `int()` before sending it back as `[Int]`.
- **BK Net REST** — `https://bkpw.net/api/v1` with `Authorization: Bearer {BKNET_API_TOKEN}`. Nation IDs arrive as strings at runtime despite typed as int — use `str(m.nation.id)` consistently in map keys.
- **Discord** — `https://discord.com/api/v10/`; `users/@me` for identity, `guilds/{id}/members/{id}` with bot token for role lookup, `guilds/{id}/roles` for role-name resolution (only at OAuth exchange time, to determine `isEmperor`).

---

## Environment Variables

```
# PnW + BK Net
PNW_API_KEY=
BKNET_API_TOKEN=           # optional; BK Net features degrade gracefully if absent

# JWT
SESSION_SECRET=            # 32+ chars

# Discord OAuth
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=      # Discord's redirect target — points at the Flet client URL
DISCORD_GUILD_ID=
DISCORD_ADMIN_ROLE=        # default: "Emperor"
DISCORD_BOT_TOKEN=

# Server
SERVER_HOST=0.0.0.0
SERVER_PORT=8000

# Client (per platform; baked at build time for mobile/desktop)
API_BASE_URL=http://localhost:8000
```

---

## Deployment

- **Server**: `uvicorn server.main:app --host 0.0.0.0 --port 8000`. Lifespan handler starts the sync loop on boot. SQLite + JSON config files live in `data/` next to the server.
- **Flet web**: `flet run --web --port 3000 client/main.py`, with `API_BASE_URL=http://localhost:8000`. Nginx routes `/` to Flet:3000 and `/api/*` to FastAPI:8000.
- **Flet desktop**: `flet pack client/main.py` produces native binaries (Windows/macOS/Linux). User installs; on first launch, reads `API_BASE_URL` from a config file in the app-data dir (or prompts).
- **Flet mobile**: `flet build apk` / `flet build ipa`. `API_BASE_URL` baked at build time.

If feasible in the current Flet release, the web variant can be a **single ASGI process** that mounts the Flet ASGI app inside the FastAPI app (`app.mount("/", flet_asgi)`), avoiding the two-port nginx routing. This is an implementation detail; both options work.

---

## Coexistence with the Existing Next.js App

- The two apps live side by side. The Next.js app continues to work unchanged.
- `flet-pnwdata/data/pnw.db` is **separate** from `data/pnw.db`. Two sync loops will run if both apps are running. That's fine — they don't share writers.
- `bot.js` currently reads `data/pnw.db`. To point it at the Flet DB, change its connection path. Otherwise leave as-is.
- During development, only one app needs to be running.

---

## Implementation Order

Each phase is independently runnable.

1. **Foundation** — `pyproject.toml`, env loader, `shared/models.py`, `shared/formulas.py` ported from the current TS formulas.
2. **Server core** — FastAPI skeleton, `db.py` with schema, sync loop, `/api/data`, `/api/sync`. Verify against a fresh DB; confirm sync writes match the current schema.
3. **Server live endpoints** — `/api/warTargets`, `/api/conflictStats`, `/api/beigeWatch` (with the 30-day/5-page cap).
4. **Server auth** — JWT, `/api/auth/exchange`, guild-member resolution via bot token, role-config and war-config endpoints.
5. **Client foundation** — Flet entry, routing, theme, `AppShell` + `Sidebar` + `Header`, `api.py` with cache, `/` and placeholders for every route.
6. **Public pages** — `/war-targets`, `/conflict`, `/optimizer`, `/` (no auth required, highest-value pages).
7. **Client auth** — `OAuthProvider` integration, exchange call, token storage, sidebar tier switching.
8. **Member pages** — dashboard, slots, members, applicants, military, mmr, infra, wars, bank, cashholders, charts, inactive, relink, explore, command-center, beige-watch.
9. **Admin pages** — `/role-config`, `/war-config`.
10. **Excel export** — `/api/export` + `ExportButton` wiring on list pages.
11. **Mobile polish** — responsive tweaks, `NavigationDrawer` on narrow widths.
12. **(Optional)** Discord bot Python port. Deferred — `bot.js` continues to work.

---

## Open Items (deliberately deferred)

1. **`bot.js` porting** — keep as-is; possible future Python port using `discord.py`.
2. **Single ASGI process for web** — try mounting Flet under FastAPI in phase 5; fall back to two-process if Flet release doesn't support it cleanly.
3. **`/charts` page** — Flet's chart widgets are slightly less expressive than Recharts (no time-axis brush, simpler legends). Will require minor visual concessions, not feature loss.
4. **Refresh-token rotation / server-side JWT invalidation** — out of scope; matches current Next.js behavior.

---

## Risks and Trade-offs

- **Native clients require a reachable server.** No offline mode. Mitigation: server can be self-hosted; the desktop/mobile build's `API_BASE_URL` can be configured per user.
- **Two ports of the same app to maintain** during transition. Mitigation: this spec deliberately keeps schemas, env vars, and config file formats identical so a future cutover is non-disruptive.
- **Flet is a smaller ecosystem than React.** Some component conveniences (Recharts time brush, `xlsx` JS lib's polished output) will need re-implementing in Python equivalents. Mitigation: `shared/formulas.py` centralizes the game-logic surface; UI work is the variable.
- **Discord OAuth on mobile depends on Flet's in-app webview behavior.** If Flet's OAuth handling proves insufficient on mobile, fall back to opening the system browser via `page.launch_url` and using a deep-link URL scheme to return.
